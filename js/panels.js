// コマ枠: テンプレート・描画・コマ枠ツール

import { h, uid } from './util.js';
import { icon } from './icons.js';
import { rectPoly, splitPolygon, pointInPolygon, polyToPath, snapAngle } from './geometry.js';
import { mmToPx, pxToMm, paperOf } from './paper.js';

export const TEMPLATES = [
  ['none', 'なし'],
  ['1', '1コマ(基本枠)'],
  ['2', '2段'],
  ['3', '3段'],
  ['4', '4段(4コマ)'],
  ['2x2', '田の字(2×2)'],
  ['3-2', '3段・中段2分割'],
];

/** コマを配置する基準の矩形(基本枠。無い用紙では余白を取った矩形) */
export function baseRect(paper) {
  // 見開きは、左右の基本枠をまとめた範囲(ノドをまたぐ大ゴマを作りやすいように)
  if (paper.frames?.length === 2) {
    const [l, r] = paper.frames;
    return { x: l.x, y: l.y, w: r.x + r.w - l.x, h: l.h };
  }
  if (paper.frame) return paper.frame;
  const m = Math.round(paper.w * 0.05);
  return { x: m, y: m, w: paper.w - m * 2, h: paper.h - m * 2 };
}

/** テンプレートからコマを作る */
export function templatePanels(paper, style, name) {
  if (!name || name === 'none') return [];
  const r = baseRect(paper);
  const rows = (n) => {
    const hh = (r.h - style.gapV * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: r.x, y: r.y + i * (hh + style.gapV), w: r.w, h: hh }));
  };
  const cols = (row, n) => {
    const ww = (row.w - style.gapH * (n - 1)) / n;
    return Array.from({ length: n }, (_, i) => ({ x: row.x + i * (ww + style.gapH), y: row.y, w: ww, h: row.h }));
  };
  let rects;
  switch (name) {
    case '1': rects = [r]; break;
    case '2': rects = rows(2); break;
    case '3': rects = rows(3); break;
    case '4': rects = rows(4); break;
    case '2x2': rects = rows(2).flatMap((row) => cols(row, 2)); break;
    case '3-2': { const rs = rows(3); rects = [rs[0], ...cols(rs[1], 2), rs[2]]; break; }
    default: rects = [];
  }
  return rects.map((q) => ({ id: uid(), points: rectPoly(q.x, q.y, q.w, q.h) }));
}

export function applyTemplate(page, paper, name) {
  page.panels = templatePanels(paper, page.panelStyle, name);
}

/** コマ枠とコマの外側のマスクを描く */
export function drawPanels(ctx, project, page) {
  if (!page.showPanels || !page.panels.length) return;
  const { w, h } = paperOf(project, page);
  ctx.save();
  if (page.maskOutside) {
    const p = new Path2D();
    p.rect(-10, -10, w + 20, h + 20);
    for (const pn of page.panels) polyToPath(pn.points, p);
    ctx.fillStyle = '#fff';
    ctx.fill(p, 'evenodd');
  }
  ctx.strokeStyle = '#000';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 10;
  ctx.lineWidth = page.panelStyle.border;
  for (const pn of page.panels) ctx.stroke(polyToPath(pn.points));
  ctx.restore();
}

// ------------------------------------------------------------------
// コマ枠ツール
//   split: 線を引いてコマを分割(コマ枠カット)
//   rect : ドラッグで長方形のコマを作成
//   edit : コマを選んで移動・頂点を動かす・削除
// ------------------------------------------------------------------
export function panelTool(ed) {
  let drag = null;
  let selectedId = null;
  const S = () => ed.settings();
  const page = () => ed.page;
  const selected = () => page().panels.find((p) => p.id === selectedId) || null;
  const hitPanel = (x, y) => [...page().panels].reverse().find((p) => pointInPolygon(x, y, p.points)) || null;

  const tool = {
    cursor: 'crosshair',
    activate() { selectedId = null; },
    deactivate() { selectedId = null; drag = null; },
    objectsRestored() { if (!selected()) selectedId = null; },

    down(p) {
      const mode = S().mode;
      const before = ed.snapshotObjects();
      if (!page().showPanels) { page().showPanels = true; ed.ui.refreshLayers(); }
      if (mode === 'split' || mode === 'rect') {
        drag = { mode, a: { x: p.x, y: p.y }, b: { x: p.x, y: p.y }, before };
      } else {
        const px = 1 / ed.view.scale;
        const sel = selected();
        if (sel) {
          const vi = sel.points.findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < 16 * px);
          if (vi >= 0) { drag = { mode: 'vertex', vi, before }; return; }
        }
        const hit = hitPanel(p.x, p.y);
        selectedId = hit?.id || null;
        drag = hit ? { mode: 'move', last: { x: p.x, y: p.y }, before } : null;
        ed.ui.refreshToolProps();
      }
      ed.requestRender();
    },

    move(p) {
      if (!drag) return;
      if (drag.mode === 'split') {
        drag.b = S().snap ? snapAngle(drag.a, p) : { x: p.x, y: p.y };
      } else if (drag.mode === 'rect') {
        drag.b = { x: p.x, y: p.y };
      } else if (drag.mode === 'vertex') {
        selected().points[drag.vi] = [p.x, p.y];
      } else if (drag.mode === 'move') {
        const dx = p.x - drag.last.x, dy = p.y - drag.last.y;
        selected().points = selected().points.map(([x, y]) => [x + dx, y + dy]);
        drag.last = { x: p.x, y: p.y };
      }
      ed.requestRender();
    },

    up() {
      if (!drag) return;
      const d = drag;
      drag = null;
      const pg = page();
      if (d.mode === 'split') {
        const st = pg.panelStyle;
        const horizontal = Math.abs(d.b.x - d.a.x) >= Math.abs(d.b.y - d.a.y);
        const gap = horizontal ? st.gapV : st.gapH;
        const next = [];
        let count = 0;
        for (const pn of pg.panels) {
          const res = splitPolygon(pn.points, d.a, d.b, gap);
          if (res) {
            count++;
            next.push({ id: uid(), points: res[0] }, { id: uid(), points: res[1] });
          } else next.push(pn);
        }
        if (count) {
          pg.panels = next;
          ed.commitObjects('コマ枠を分割', d.before);
        }
      } else if (d.mode === 'rect') {
        const x = Math.min(d.a.x, d.b.x), y = Math.min(d.a.y, d.b.y);
        const w = Math.abs(d.b.x - d.a.x), hh = Math.abs(d.b.y - d.a.y);
        if (w > 10 && hh > 10) {
          pg.panels.push({ id: uid(), points: rectPoly(x, y, w, hh) });
          ed.commitObjects('コマ枠を作成', d.before);
        }
      } else {
        ed.commitObjects(d.mode === 'vertex' ? 'コマの頂点を移動' : 'コマを移動', d.before);
      }
      ed.requestRender();
    },

    cancel() {
      if (drag?.before && (drag.mode === 'move' || drag.mode === 'vertex')) Object.assign(page(), JSON.parse(drag.before));
      drag = null;
      ed.requestRender();
    },

    onKey(e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) {
        tool.deleteSelected();
        return true;
      }
      if (e.key === 'Escape' && selectedId) { selectedId = null; ed.requestRender(); return true; }
      return false;
    },

    deleteSelected() {
      const before = ed.snapshotObjects();
      page().panels = page().panels.filter((p) => p.id !== selectedId);
      selectedId = null;
      ed.commitObjects('コマを削除', before);
      ed.ui.refreshToolProps();
    },

    overlay(ctx, px) {
      ctx.save();
      const sel = selected();
      if (sel) {
        ctx.fillStyle = 'rgba(61,142,230,.15)';
        ctx.fill(polyToPath(sel.points));
        ctx.strokeStyle = '#3d8ee6';
        ctx.lineWidth = 2 * px;
        ctx.stroke(polyToPath(sel.points));
        for (const [x, y] of sel.points) {
          ctx.fillStyle = '#fff';
          ctx.fillRect(x - 5 * px, y - 5 * px, 10 * px, 10 * px);
          ctx.strokeRect(x - 5 * px, y - 5 * px, 10 * px, 10 * px);
        }
      }
      if (drag?.mode === 'split') {
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([8 * px, 5 * px]);
        ctx.beginPath(); ctx.moveTo(drag.a.x, drag.a.y); ctx.lineTo(drag.b.x, drag.b.y); ctx.stroke();
      } else if (drag?.mode === 'rect') {
        ctx.strokeStyle = '#3d8ee6';
        ctx.lineWidth = 2 * px;
        ctx.setLineDash([8 * px, 5 * px]);
        ctx.strokeRect(drag.a.x, drag.a.y, drag.b.x - drag.a.x, drag.b.y - drag.a.y);
      }
      ctx.restore();
    },

    /** ツールプロパティ: ページ単位のコマ枠設定とテンプレート */
    buildProps(box, ui) {
      const pg = page(), paper = ed.paper, st = pg.panelStyle;
      // スライダーを動かしている間は即反映し、止まってから 1 回だけ履歴に積む
      let pending = null, timer = null;
      const mmProp = (label, key, min, max) => ui.control(
        { label, type: 'range', min, max, step: 0.1, fmt: (v) => `${(+v).toFixed(1)}mm` },
        +pxToMm(paper, st[key]).toFixed(1),
        (v) => {
          pending ??= ed.snapshotObjects();
          st[key] = Math.max(1, mmToPx(paper, v));
          ed.requestRender();
          clearTimeout(timer);
          timer = setTimeout(() => { ed.commitObjects('コマ枠の設定', pending); pending = null; }, 400);
        });
      box.append(
        mmProp('枠線の太さ', 'border', 0.1, 3),
        mmProp('左右のコマの間隔', 'gapH', 0.5, 15),
        mmProp('上下のコマの間隔', 'gapV', 0.5, 20),
        ui.control({ label: 'コマの外側を白で隠す', type: 'check' }, pg.maskOutside, (v) => {
          const before = ed.snapshotObjects();
          pg.maskOutside = v;
          ed.commitObjects('コマ外のマスク', before);
        }),
      );
      const tpl = h('select', { class: 'select' }, TEMPLATES.filter(([v]) => v !== 'none').map(([v, l]) => h('option', { value: v }, l)));
      box.append(h('div', { class: 'prop' },
        h('span', { class: 'prop-label' }, 'テンプレート(基本枠に配置)'),
        h('div', { class: 'row' }, tpl, h('button', {
          class: 'btn small', onclick: () => {
            const before = ed.snapshotObjects();
            applyTemplate(pg, paper, tpl.value);
            pg.showPanels = true;
            selectedId = null;
            ed.commitObjects('コマ枠テンプレート', before);
            ed.ui.refreshLayers();
          },
        }, '配置'))));
      const btns = h('div', { class: 'row' });
      if (selected()) btns.append(h('button', { class: 'btn small danger', onclick: () => tool.deleteSelected() }, '選択中のコマを削除'));
      btns.append(h('button', {
        class: 'btn small', onclick: () => {
          const before = ed.snapshotObjects();
          pg.panels = [];
          selectedId = null;
          ed.commitObjects('コマ枠をすべて削除', before);
          ed.ui.refreshToolProps();
        },
      }, 'すべて削除'));
      box.append(btns);
      const hints = {
        split: '線を引くと、その線が通るコマを分割します。横向きの線は「上下の間隔」、縦向きの線は「左右の間隔」で分かれます。',
        rect: 'ドラッグして長方形のコマを作ります。',
        edit: 'コマをタップして選択。ドラッグで移動、四角いハンドルで頂点を動かせます(斜めのコマも作れます)。',
      };
      box.append(h('p', { class: 'hint' }, hints[S().mode]));
    },

    /** レイヤーパレットの上部に出す「コマ枠」行 */
    layerRow() {
      const pg = page();
      const row = h('div', { class: 'layer-row fixed' + (pg.showPanels ? '' : ' hidden-layer') },
        h('button', {
          class: 'icon-btn eye', title: '表示/非表示', html: icon(pg.showPanels ? 'eye' : 'eyeOff', 16),
          onclick: (e) => { e.stopPropagation(); pg.showPanels = !pg.showPanels; ed.ui.refreshLayers(); ed.changed(); },
        }),
        h('span', { class: 'fixed-ic', html: icon('panel', 18) }),
        h('div', { class: 'layer-name' }, h('div', { class: 'name' }, 'コマ枠'), h('div', { class: 'meta' }, `${pg.panels.length} コマ`)));
      row.addEventListener('click', () => ed.setTool('panel'));
      return row;
    },
  };
  return tool;
}

