// 塗りつぶし・囲って塗る・選択範囲・変形・図形(直線/長方形/楕円/集中線/流線)ツール

import { h, makeCanvas, releaseCanvas, clipRect } from './util.js';
import { renderPage } from './render.js';
import { floodMask, maskToCanvas, tonePattern, drawFocusLines, drawSpeedLines } from './effects.js';
import { polyToPath, polyBounds, snapAngle } from './geometry.js';
import { toast } from './dialog.js';

// ------------------------------------------------------------------
// 共通: 範囲を色/トーンで塗ってレイヤーに描き込む(取り消し履歴付き)
//   mask: マスク画像(rect と同じ大きさ) / path: ページ座標の Path2D
// ------------------------------------------------------------------
export function applyPaint(ed, layer, rect, { mask = null, path = null, paint, label = '塗りつぶし' }) {
  const { w, h: H } = ed.project.paper;
  const r = clipRect(rect, w, H);
  if (!r) return;
  const pc = makeCanvas(r.w, r.h);
  const p = pc.getContext('2d');
  if (paint.type === 'tone') {
    const pat = tonePattern(p, { dpi: ed.project.paper.dpi, lpi: paint.lpi, density: paint.density, angle: 0, color: paint.color });
    // ページの原点を基準に網点をそろえる(隣り合う塗りで網点がずれないように)
    pat.setTransform?.(new DOMMatrix().translate(-r.x, -r.y).rotate(paint.angle));
    p.fillStyle = pat;
  } else p.fillStyle = paint.color;
  p.fillRect(0, 0, r.w, r.h);
  p.globalCompositeOperation = 'destination-in';
  if (mask) p.drawImage(mask, rect.x - r.x, rect.y - r.y);
  if (path) { p.save(); p.translate(-r.x, -r.y); p.fill(path); p.restore(); }
  const sel = ed.selectionPath();
  if (sel && sel !== path) { p.save(); p.translate(-r.x, -r.y); p.fill(sel); p.restore(); }
  const ctx = layer.canvas.getContext('2d');
  const before = ctx.getImageData(r.x, r.y, r.w, r.h);
  ctx.save();
  if (paint.erase) ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(pc, r.x, r.y);
  ctx.restore();
  const after = ctx.getImageData(r.x, r.y, r.w, r.h);
  releaseCanvas(pc);
  ed.pushRaster(label, layer, r, before, after);
}

/** 塗りの指定(色 or トーン)を現在の色と設定から作る */
function paintFrom(ed, s) {
  return {
    type: s.paint === 'tone' ? 'tone' : 'color',
    color: ed.color.transparent ? '#000000' : ed.currentColor(),
    erase: ed.color.transparent,
    lpi: s.lpi ?? 60, density: s.density ?? 0.2, angle: s.angle ?? 45,
  };
}

/** レイヤーの描かれている範囲 */
function contentBounds(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  let x1 = w, y1 = h, x2 = -1, y2 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3]) {
        if (x < x1) x1 = x;
        if (x > x2) x2 = x;
        if (y < y1) y1 = y;
        if (y > y2) y2 = y;
      }
    }
  }
  return x2 < 0 ? null : { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 };
}

export function createPaintTools(ed) {
  return {
    fill: fillTool(ed),
    lassofill: lassoFillTool(ed),
    select: selectTool(ed),
    shape: shapeTool(ed),
    transform: transformTool(ed),
  };
}

// ---------------- 塗りつぶし ----------------
function fillTool(ed) {
  return {
    cursor: 'crosshair',
    down(p) {
      const L = ed.editableLayer();
      if (!L) return;
      const s = ed.settings();
      const { w, h } = ed.project.paper;
      let img;
      if (s.ref === 'layer') {
        img = L.canvas.getContext('2d').getImageData(0, 0, w, h);
      } else {
        // 表示されている絵・コマ枠・フキダシを境界として参照する
        const c = makeCanvas(w, h);
        const cx = c.getContext('2d');
        renderPage(cx, ed.project, ed.page, { includeDraft: false });
        img = cx.getImageData(0, 0, w, h);
        releaseCanvas(c);
      }
      const res = floodMask(img, p.x, p.y, s.tolerance, s.expand);
      if (!res) return;
      if (res.bbox.w * res.bbox.h > w * h * 0.98 && s.ref !== 'layer') toast('閉じていない範囲を塗りました');
      const mask = maskToCanvas(res.mask, w, res.bbox);
      applyPaint(ed, L, res.bbox, { mask, paint: paintFrom(ed, s), label: s.paint === 'tone' ? 'トーン' : '塗りつぶし' });
      releaseCanvas(mask);
    },
    move() {},
    up() {},
    cancel() {},
  };
}

// ---------------- 囲って塗る ----------------
function lassoFillTool(ed) {
  let pts = null;
  return {
    cursor: 'crosshair',
    down(p) { pts = [[p.x, p.y]]; },
    move(p) {
      if (!pts) return;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * ed.view.scale > 2) pts.push([p.x, p.y]);
      ed.requestRender();
    },
    up() {
      const poly = pts;
      pts = null;
      ed.requestRender();
      if (!poly || poly.length < 3) return;
      const L = ed.editableLayer();
      if (!L) return;
      const b = polyBounds(poly);
      applyPaint(ed, L, { x: b.x - 1, y: b.y - 1, w: b.w + 2, h: b.h + 2 }, { path: polyToPath(poly), paint: paintFrom(ed, ed.settings()), label: '囲って塗る' });
    },
    cancel() { pts = null; ed.requestRender(); },
    overlay(ctx, px) {
      if (!pts) return;
      ctx.save();
      ctx.fillStyle = 'rgba(61,142,230,.25)';
      ctx.strokeStyle = '#3d8ee6';
      ctx.lineWidth = 1.5 * px;
      const path = polyToPath(pts);
      ctx.fill(path);
      ctx.stroke(path);
      ctx.restore();
    },
  };
}

// ---------------- 選択範囲 ----------------
function selectTool(ed) {
  let drag = null;
  return {
    cursor: 'crosshair',
    down(p) {
      drag = { shape: ed.settings().shape, a: p, b: p, pts: [[p.x, p.y]] };
    },
    move(p) {
      if (!drag) return;
      drag.b = p;
      const last = drag.pts[drag.pts.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * ed.view.scale > 2) drag.pts.push([p.x, p.y]);
      ed.requestRender();
    },
    up() {
      const d = drag;
      drag = null;
      if (!d) return;
      const moved = Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) * ed.view.scale > 4;
      if (!moved) { ed.setSelection(null); return; }
      let poly;
      if (d.shape === 'rect') {
        const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y);
        const w = Math.abs(d.b.x - d.a.x), hh = Math.abs(d.b.y - d.a.y);
        poly = [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]];
      } else {
        if (d.pts.length < 3) { ed.setSelection(null); return; }
        poly = d.pts;
      }
      ed.setSelection({ path: polyToPath(poly), bounds: polyBounds(poly), poly });
    },
    cancel() { drag = null; ed.requestRender(); },
    overlay(ctx, px) {
      if (!drag) return;
      ctx.save();
      ctx.lineWidth = px;
      ctx.setLineDash([4 * px, 4 * px]);
      ctx.strokeStyle = '#000';
      if (drag.shape === 'rect') ctx.strokeRect(drag.a.x, drag.a.y, drag.b.x - drag.a.x, drag.b.y - drag.a.y);
      else ctx.stroke(polyToPath(drag.pts));
      ctx.restore();
    },
  };
}

// ---------------- 変形(拡大・縮小・回転) ----------------
function transformTool(ed) {
  let st = null, drag = null;
  const HANDLE = 14;
  const local = (p) => {
    const dx = p.x - st.cx, dy = p.y - st.cy, c = Math.cos(-st.rot), s = Math.sin(-st.rot);
    return { x: dx * c - dy * s, y: dx * s + dy * c };
  };
  const world = (lx, ly) => {
    const c = Math.cos(st.rot), s = Math.sin(st.rot);
    return { x: st.cx + lx * c - ly * s, y: st.cy + lx * s + ly * c };
  };
  const corners = () => [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ({ sx, sy, ...world((sx * st.w) / 2, (sy * st.h) / 2) }));
  const rotHandle = () => world(0, -st.h / 2 - 36 / ed.view.scale);

  const tool = {
    cursor: 'move',
    title: '変形',
    get active() { return !!st; },
    start() {
      const L = ed.editableLayer();
      if (!L) return;
      const { w, h } = ed.project.paper;
      const sel = ed.selection;
      const b = sel ? clipRect(sel.bounds, w, h) : contentBounds(L.canvas);
      if (!b) { toast('変形するものがありません'); return; }
      const ctx = L.canvas.getContext('2d');
      const before = ctx.getImageData(0, 0, w, h);
      const img = makeCanvas(b.w, b.h);
      const ic = img.getContext('2d');
      ic.save();
      ic.translate(-b.x, -b.y);
      if (sel) ic.clip(sel.path);
      ic.drawImage(L.canvas, 0, 0);
      ic.restore();
      ctx.save();
      if (sel) ctx.clip(sel.path);
      ctx.clearRect(b.x, b.y, b.w, b.h);
      ctx.restore();
      st = { layer: L, img, cx: b.x + b.w / 2, cy: b.y + b.h / 2, w: b.w, h: b.h, rot: 0, fx: 1, fy: 1, before };
      ed.selection = null;
      ed.enterTempTool(tool);
    },
    confirm() {
      if (!st) return;
      const L = st.layer, ctx = L.canvas.getContext('2d');
      const { w, h } = ed.project.paper;
      ctx.save();
      ctx.imageSmoothingQuality = 'high';
      tool.drawFloating(ctx);
      ctx.restore();
      const after = ctx.getImageData(0, 0, w, h);
      ed.pushRaster('変形', L, { x: 0, y: 0, w, h }, st.before, after);
      tool.finish();
    },
    escape() {
      if (!st) return;
      st.layer.canvas.getContext('2d').putImageData(st.before, 0, 0);
      tool.finish();
    },
    finish() {
      releaseCanvas(st?.img);
      st = null;
      drag = null;
      ed.exitTempTool();
    },
    beforeUndo() { tool.escape(); },
    drawFloating(ctx) {
      ctx.translate(st.cx, st.cy);
      ctx.rotate(st.rot);
      ctx.scale(st.fx, st.fy);
      ctx.drawImage(st.img, -st.w / 2, -st.h / 2, st.w, st.h);
    },
    afterLayer(ctx, L) {
      if (!st || L !== st.layer) return;
      ctx.save();
      ctx.globalAlpha = L.opacity;
      tool.drawFloating(ctx);
      ctx.restore();
    },
    down(p) {
      if (!st) return;
      const px = 1 / ed.view.scale;
      const rh = rotHandle();
      if (Math.hypot(rh.x - p.x, rh.y - p.y) < HANDLE * 1.5 * px) {
        drag = { mode: 'rotate', a0: Math.atan2(p.y - st.cy, p.x - st.cx), r0: st.rot };
        return;
      }
      const c = corners().find((q) => Math.hypot(q.x - p.x, q.y - p.y) < HANDLE * 1.5 * px);
      if (c) {
        drag = { mode: 'scale', sx: c.sx, sy: c.sy, w0: st.w, h0: st.h, opp: world((-c.sx * st.w) / 2, (-c.sy * st.h) / 2) };
        return;
      }
      drag = { mode: 'move', last: p };
    },
    move(p) {
      if (!st || !drag) return;
      if (drag.mode === 'move') {
        st.cx += p.x - drag.last.x;
        st.cy += p.y - drag.last.y;
        drag.last = p;
      } else if (drag.mode === 'rotate') {
        let r = drag.r0 + Math.atan2(p.y - st.cy, p.x - st.cx) - drag.a0;
        if (p.shift) r = Math.round(r / (Math.PI / 12)) * (Math.PI / 12);
        st.rot = r;
      } else if (drag.mode === 'scale') {
        // 反対側の角を固定したまま拡大縮小する
        const o = drag.opp;
        const c = Math.cos(-st.rot), s = Math.sin(-st.rot);
        const dx = p.x - o.x, dy = p.y - o.y;
        let lw = Math.abs(dx * c - dy * s), lh = Math.abs(dx * s + dy * c);
        if (tool.keepAspect) {
          const k = Math.max(lw / drag.w0, lh / drag.h0);
          lw = drag.w0 * k; lh = drag.h0 * k;
        }
        st.w = Math.max(2, lw);
        st.h = Math.max(2, lh);
        const cc = Math.cos(st.rot), ss = Math.sin(st.rot);
        const hx = (drag.sx * st.w) / 2, hy = (drag.sy * st.h) / 2;
        st.cx = o.x + hx * cc - hy * ss;
        st.cy = o.y + hx * ss + hy * cc;
      }
      ed.requestRender();
    },
    up() { drag = null; ed.ui.refreshToolProps(); },
    cancel() { drag = null; },
    onKey(e) {
      if (!st) return false;
      if (e.key === 'Enter') { tool.confirm(); return true; }
      if (e.key === 'Escape') { tool.escape(); return true; }
      return false;
    },
    keepAspect: true,
    overlay(ctx, px) {
      if (!st) return;
      const cs = corners();
      ctx.save();
      ctx.strokeStyle = '#3d8ee6';
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      cs.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.stroke();
      const top = world(0, -st.h / 2), rh = rotHandle();
      ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(rh.x, rh.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      for (const q of cs) {
        ctx.fillRect(q.x - 6 * px, q.y - 6 * px, 12 * px, 12 * px);
        ctx.strokeRect(q.x - 6 * px, q.y - 6 * px, 12 * px, 12 * px);
      }
      ctx.beginPath(); ctx.arc(rh.x, rh.y, 7 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#3d8ee6'; ctx.fill();
      ctx.restore();
    },
    buildProps(box, ui) {
      if (!st) return;
      box.append(
        h('p', { class: 'hint' }, '中をドラッグで移動、四隅で拡大縮小、上の青い丸で回転します。'),
        ui.control({ label: '縦横比を固定', type: 'check' }, tool.keepAspect, (v) => { tool.keepAspect = v; }),
        h('div', { class: 'prop-val' }, `${Math.round(st.w)} × ${Math.round(st.h)} px / ${Math.round((st.rot * 180) / Math.PI)}°`),
        h('div', { class: 'row' },
          h('button', { class: 'btn small', onclick: () => { st.fx *= -1; ed.requestRender(); } }, '左右反転'),
          h('button', { class: 'btn small', onclick: () => { st.fy *= -1; ed.requestRender(); } }, '上下反転')),
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => tool.confirm() }, '確定 (Enter)'),
          h('button', { class: 'btn small', onclick: () => tool.escape() }, 'キャンセル (Esc)')),
      );
    },
    floatBar() {
      return st ? [['確定', () => tool.confirm(), true], ['キャンセル', () => tool.escape()]] : null;
    },
  };
  return tool;
}

// ---------------- 図形・集中線・流線 ----------------
function shapeTool(ed) {
  let drag = null;
  const tool = {
    cursor: 'crosshair',
    down(p) {
      if (!ed.editableLayer()) return;
      drag = { a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y } };
    },
    move(p) {
      if (!drag) return;
      const s = ed.settings();
      drag.b = s.form === 'line' && s.snap ? snapAngle(drag.a, p) : { x: p.x, y: p.y };
      ed.requestRender();
    },
    up() {
      const d = drag;
      drag = null;
      ed.requestRender();
      if (!d) return;
      const L = ed.editableLayer();
      if (!L) return;
      const s = ed.settings();
      const { a, b } = d;
      if (Math.hypot(b.x - a.x, b.y - a.y) * ed.view.scale < 4) return;
      const color = ed.color.transparent ? '#000000' : ed.currentColor();
      const labels = { line: '直線', rect: '長方形', ellipse: '楕円', focus: '集中線', speed: '流線' };
      ed.rasterOp(labels[s.form], L, (ctx) => {
        ctx.save();
        if (ed.color.transparent) ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = ctx.fillStyle = color;
        ctx.lineWidth = s.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        const sel = ed.selectionPath();
        if (s.form === 'focus' || s.form === 'speed') {
          const region = ed.regionAt(a.x, a.y);
          if (region.path) ctx.clip(region.path);
          const B = region.bounds;
          if (s.form === 'focus') {
            const far = Math.max(...[[B.x, B.y], [B.x + B.w, B.y], [B.x, B.y + B.h], [B.x + B.w, B.y + B.h]].map(([x, y]) => Math.hypot(x - a.x, y - a.y)));
            drawFocusLines(ctx, {
              cx: a.x, cy: a.y, rx: Math.max(4, Math.abs(b.x - a.x)), ry: Math.max(4, Math.abs(b.y - a.y)),
              outer: far * 1.05, count: s.count, width: s.lineW, jitter: s.jitter, color,
            });
          } else {
            drawSpeedLines(ctx, { ax: a.x, ay: a.y, bx: b.x, by: b.y, bounds: B, count: s.count, width: s.lineW, jitter: s.jitter, color });
          }
        } else {
          if (sel) ctx.clip(sel);
          ctx.beginPath();
          if (s.form === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
          else {
            const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), hh = Math.abs(b.y - a.y);
            if (s.form === 'rect') ctx.rect(x, y, w, hh);
            else ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, Math.PI * 2);
            if (s.fillMode === 'fill') ctx.fill(); else ctx.stroke();
          }
        }
        ctx.restore();
      });
    },
    cancel() { drag = null; ed.requestRender(); },
    overlay(ctx, px) {
      if (!drag) return;
      const s = ed.settings(), { a, b } = drag;
      ctx.save();
      ctx.strokeStyle = '#3d8ee6';
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([6 * px, 4 * px]);
      ctx.beginPath();
      if (s.form === 'line') { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      else if (s.form === 'rect') ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else if (s.form === 'ellipse') ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
      else if (s.form === 'focus') {
        ctx.ellipse(a.x, a.y, Math.max(1, Math.abs(b.x - a.x)), Math.max(1, Math.abs(b.y - a.y)), 0, 0, Math.PI * 2);
        ctx.moveTo(a.x - 8 * px, a.y); ctx.lineTo(a.x + 8 * px, a.y);
        ctx.moveTo(a.x, a.y - 8 * px); ctx.lineTo(a.x, a.y + 8 * px);
      } else if (s.form === 'speed') {
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        for (const d of [2.6, -2.6]) { ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(ang + d) * 14 * px, b.y + Math.sin(ang + d) * 14 * px); }
      }
      ctx.stroke();
      ctx.restore();
    },
  };
  return tool;
}
