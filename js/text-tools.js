// テキストツール・フキダシツール・操作(オブジェクト選択)ツール

import { h, uid } from './util.js';
import { icon } from './icons.js';
import { FONTS, SHAPES, fitItemToText, hitItem } from './text.js';
import { ptToPx, pxToPt, mmToPx, pxToMm } from './paper.js';
import { showDialog, toast } from './dialog.js';

/** テキストツールの設定を元に新しいテキスト/フキダシを作る */
function newItem(ed, props) {
  const ts = ed.settings('text');
  const paper = ed.project.paper;
  return {
    id: uid(), x: 0, y: 0, w: 1, h: 1, text: '',
    font: ts.font, size: ptToPx(paper, ts.sizePt), vertical: ts.vertical, bold: ts.bold,
    lineHeight: ts.lineHeight, letterSpacing: 1, color: '#000000', outline: ts.outline,
    shape: 'none', stroke: mmToPx(paper, 0.35), fill: '#ffffff', tail: null, tailWidth: 1, autoFit: true,
    ...props,
  };
}

/** セリフ入力ダイアログ。OK なら item を書き換えて true */
export async function editItemDialog(ed, item, isNew) {
  const paper = ed.project.paper;
  const ta = h('textarea', { class: 'input', rows: 5, placeholder: 'セリフを入力(改行で次の行へ)' });
  ta.value = item.text;
  const font = h('select', { class: 'select' }, Object.entries(FONTS).map(([k, f]) => h('option', { value: k, selected: k === item.font }, f.label)));
  const size = h('input', { type: 'number', class: 'input', min: 3, max: 200, step: 0.5, value: +pxToPt(paper, item.size).toFixed(1) });
  const vertical = h('input', { type: 'checkbox', checked: item.vertical });
  const bold = h('input', { type: 'checkbox', checked: item.bold });
  const body = h('div', { class: 'form' },
    ta,
    h('div', { class: 'field-row' },
      h('label', { class: 'field' }, h('span', {}, 'フォント'), font),
      h('label', { class: 'field', style: { maxWidth: '110px' } }, h('span', {}, 'サイズ (pt)'), size)),
    h('div', { class: 'row' },
      h('label', { class: 'check' }, vertical, '縦書き'),
      h('label', { class: 'check' }, bold, '太字')),
  );
  const ok = await showDialog({
    title: isNew ? 'テキストを入力' : 'テキストを編集', body, wide: true,
    buttons: [{ label: 'キャンセル', value: false }, { label: 'OK', value: true, primary: true }],
  });
  if (!ok) return false;
  Object.assign(item, {
    text: ta.value.replace(/\s+$/, ''),
    font: font.value,
    size: ptToPx(paper, Math.max(3, +size.value || 9)),
    vertical: vertical.checked,
    bold: bold.checked,
  });
  if (item.autoFit) fitItemToText(item);
  return true;
}

export function createTextTools(ed) {
  const page = () => ed.page;
  let selectedId = null;
  const selected = () => page().items.find((i) => i.id === selectedId) || null;
  const select = (id) => { selectedId = id; ed.ui.refreshToolProps(); ed.requestRender(); };

  /** 既存アイテムの文字を編集する */
  async function editExisting(item) {
    const before = ed.snapshotObjects();
    if (await editItemDialog(ed, item, false)) ed.commitObjects('テキストを編集', before);
    ed.requestRender();
  }

  /** アイテムの枠を薄く表示(テキスト系ツールの使用中) */
  function drawBoxes(ctx, px) {
    ctx.save();
    ctx.lineWidth = px;
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.strokeStyle = 'rgba(61,142,230,.6)';
    for (const it of page().items) ctx.strokeRect(it.x, it.y, it.w, it.h);
    ctx.restore();
  }

  // ---------------- テキストツール ----------------
  const text = {
    cursor: 'text',
    down(p) { this.start = p; },
    move() {},
    async up(p) {
      if (!this.start) return;
      this.start = null;
      const hit = hitItem(page().items, p.x, p.y);
      if (hit) return editExisting(hit);
      const before = ed.snapshotObjects();
      const item = newItem(ed, {});
      item.x = p.x; item.y = p.y;
      if (await editItemDialog(ed, item, true) && item.text) {
        fitItemToText(item);
        // 押した位置を中心にする
        item.x = p.x - item.w / 2; item.y = p.y - item.h / 2;
        page().items.push(item);
        page().showItems = true;
        selectedId = item.id;
        ed.commitObjects('テキストを追加', before);
      }
      ed.requestRender();
    },
    cancel() { this.start = null; },
    overlay: (ctx, px) => drawBoxes(ctx, px),
  };

  // ---------------- フキダシツール ----------------
  let bDrag = null;
  const balloon = {
    cursor: 'crosshair',
    down(p) {
      const s = ed.settings();
      if (s.mode === 'tail') {
        const hit = hitItem(page().items.filter((i) => i.shape !== 'none'), p.x, p.y);
        bDrag = hit ? { mode: 'tail', item: hit, before: ed.snapshotObjects(), oldTail: hit.tail } : null;
        if (!hit) toast('フキダシの中からドラッグしてください');
        return;
      }
      bDrag = { mode: 'new', a: p, b: p };
    },
    move(p) {
      if (!bDrag) return;
      if (bDrag.mode === 'tail') bDrag.item.tail = { x: p.x, y: p.y };
      else bDrag.b = p;
      ed.requestRender();
    },
    async up() {
      const d = bDrag;
      bDrag = null;
      if (!d) return;
      if (d.mode === 'tail') {
        ed.commitObjects('しっぽを付ける', d.before);
        return;
      }
      const s = ed.settings();
      const before = ed.snapshotObjects();
      const item = newItem(ed, { shape: s.shape, stroke: mmToPx(ed.project.paper, s.strokeMm) });
      let w = Math.abs(d.b.x - d.a.x), hh = Math.abs(d.b.y - d.a.y);
      const dragged = w * ed.view.scale > 20 && hh * ed.view.scale > 20;
      if (!dragged) {
        w = ed.project.paper.w * 0.14;
        hh = w * 1.35;
        item.x = d.a.x - w / 2; item.y = d.a.y - hh / 2;
      } else {
        item.x = Math.min(d.a.x, d.b.x); item.y = Math.min(d.a.y, d.b.y);
        item.autoFit = false;
      }
      item.w = w; item.h = hh;
      if (await editItemDialog(ed, item, true)) {
        page().items.push(item);
        page().showItems = true;
        selectedId = item.id;
        ed.commitObjects('フキダシを追加', before);
      }
      ed.requestRender();
    },
    cancel() {
      if (bDrag?.mode === 'tail') bDrag.item.tail = bDrag.oldTail;
      bDrag = null;
      ed.requestRender();
    },
    overlay(ctx, px) {
      drawBoxes(ctx, px);
      if (bDrag?.mode === 'new') {
        ctx.save();
        ctx.lineWidth = 1.5 * px;
        ctx.strokeStyle = '#3d8ee6';
        ctx.setLineDash([6 * px, 4 * px]);
        const { a, b } = bDrag;
        ctx.beginPath();
        ctx.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, Math.abs(b.x - a.x) / 2, Math.abs(b.y - a.y) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    },
  };

  // ---------------- 操作ツール ----------------
  let oDrag = null;
  const HANDLE = 12;
  const handles = (it) => [[it.x, it.y], [it.x + it.w, it.y], [it.x + it.w, it.y + it.h], [it.x, it.y + it.h]];

  const object = {
    cursor: 'default',
    deactivate() { oDrag = null; },
    objectsRestored() { if (!selected()) selectedId = null; },
    down(p) {
      const px = 1 / ed.view.scale;
      const sel = selected();
      const before = ed.snapshotObjects();
      if (sel) {
        if (sel.tail && Math.hypot(sel.tail.x - p.x, sel.tail.y - p.y) < HANDLE * 1.5 * px) {
          oDrag = { mode: 'tail', before };
          return;
        }
        const hi = handles(sel).findIndex(([x, y]) => Math.hypot(x - p.x, y - p.y) < HANDLE * 1.5 * px);
        if (hi >= 0) {
          const opp = handles(sel)[(hi + 2) % 4];
          oDrag = { mode: 'resize', opp, before };
          return;
        }
      }
      const hit = hitItem(page().items, p.x, p.y);
      if (!hit) { select(null); oDrag = null; return; }
      const wasSelected = hit.id === selectedId;
      if (!wasSelected) select(hit.id);
      oDrag = { mode: 'move', start: p, last: p, before, wasSelected, moved: false };
    },
    move(p) {
      if (!oDrag) return;
      const it = selected();
      if (!it) return;
      if (oDrag.mode === 'move') {
        const dx = p.x - oDrag.last.x, dy = p.y - oDrag.last.y;
        if (Math.hypot(p.x - oDrag.start.x, p.y - oDrag.start.y) * ed.view.scale > 4) oDrag.moved = true;
        it.x += dx; it.y += dy;
        if (it.tail) { it.tail.x += dx; it.tail.y += dy; }
        oDrag.last = p;
      } else if (oDrag.mode === 'resize') {
        const [ox, oy] = oDrag.opp;
        it.x = Math.min(ox, p.x); it.y = Math.min(oy, p.y);
        it.w = Math.max(10, Math.abs(p.x - ox)); it.h = Math.max(10, Math.abs(p.y - oy));
        it.autoFit = false;
      } else if (oDrag.mode === 'tail') {
        it.tail = { x: p.x, y: p.y };
      }
      ed.requestRender();
    },
    up() {
      const d = oDrag;
      oDrag = null;
      if (!d) return;
      const it = selected();
      // 選択済みのものを動かさずにタップしたら文字を編集
      if (d.mode === 'move' && d.wasSelected && !d.moved && it) return editExisting(it);
      ed.commitObjects(d.mode === 'resize' ? 'サイズ変更' : d.mode === 'tail' ? 'しっぽを移動' : '移動', d.before);
    },
    cancel() {
      if (oDrag?.before) Object.assign(page(), JSON.parse(oDrag.before));
      oDrag = null;
      ed.requestRender();
    },
    onKey(e) {
      if (!selected()) return false;
      if (e.key === 'Delete' || e.key === 'Backspace') { object.remove(); return true; }
      if (e.key === 'Escape') { select(null); return true; }
      if (e.key === 'Enter') { editExisting(selected()); return true; }
      return false;
    },
    remove() {
      const before = ed.snapshotObjects();
      page().items = page().items.filter((i) => i.id !== selectedId);
      selectedId = null;
      ed.commitObjects('削除', before);
      ed.ui.refreshToolProps();
    },
    reorder(dir) {
      const items = page().items, i = items.findIndex((x) => x.id === selectedId), j = i + dir;
      if (i < 0 || j < 0 || j >= items.length) return;
      const before = ed.snapshotObjects();
      [items[i], items[j]] = [items[j], items[i]];
      ed.commitObjects('重ね順', before);
    },
    overlay(ctx, px) {
      drawBoxes(ctx, px);
      const it = selected();
      if (!it) return;
      ctx.save();
      ctx.lineWidth = 1.5 * px;
      ctx.strokeStyle = '#3d8ee6';
      ctx.strokeRect(it.x, it.y, it.w, it.h);
      for (const [x, y] of handles(it)) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px);
        ctx.strokeRect(x - 6 * px, y - 6 * px, 12 * px, 12 * px);
      }
      if (it.tail) {
        ctx.beginPath();
        ctx.arc(it.tail.x, it.tail.y, 7 * px, 0, Math.PI * 2);
        ctx.fillStyle = '#ff9f1a';
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    },
    buildProps(box, ui) {
      const it = selected();
      if (!it) {
        box.append(h('p', { class: 'hint' }, 'テキストやフキダシをタップして選択します。ドラッグで移動、四隅でサイズ変更、オレンジの点でしっぽを動かせます。選択中のものをもう一度タップすると文字を編集できます。'));
        return;
      }
      const paper = ed.project.paper;
      const live = (label, fn) => (v) => ed.live(label, () => fn(v));
      const refit = () => { if (it.autoFit) fitItemToText(it); };
      box.append(
        h('div', { class: 'row' },
          h('button', { class: 'btn small primary', onclick: () => editExisting(it) }, '文字を編集'),
          h('button', { class: 'btn small', onclick: () => ed.live('サイズを文字に合わせる', () => { it.autoFit = true; fitItemToText(it); }) }, '文字に合わせる')),
        ui.control({ label: 'フォント', type: 'select', string: true, options: Object.entries(FONTS).map(([k, f]) => [k, f.label]) }, it.font, live('フォント', (v) => { it.font = v; refit(); })),
        ui.control({ label: '文字サイズ', type: 'range', min: 4, max: 72, step: 0.5, unit: 'pt' }, +pxToPt(paper, it.size).toFixed(1), live('文字サイズ', (v) => { it.size = ptToPx(paper, v); refit(); })),
        ui.control({ label: '縦書き', type: 'check' }, it.vertical, live('縦書き', (v) => { it.vertical = v; refit(); })),
        ui.control({ label: '太字', type: 'check' }, it.bold, live('太字', (v) => { it.bold = v; refit(); })),
        ui.control({ label: '行間', type: 'range', min: 1, max: 2.5, step: 0.05, fmt: (v) => (+v).toFixed(2) }, it.lineHeight, live('行間', (v) => { it.lineHeight = v; refit(); })),
        ui.control({ label: '白フチ', type: 'range', min: 0, max: 30, step: 1, unit: 'px' }, it.outline, live('白フチ', (v) => { it.outline = v; })),
        ui.control({ label: '文字の色', type: 'color' }, it.color, live('文字の色', (v) => { it.color = v; })),
        ui.control({ label: 'フキダシの形', type: 'select', string: true, options: SHAPES }, it.shape, live('フキダシの形', (v) => { it.shape = v; refit(); })),
      );
      if (it.shape !== 'none') {
        box.append(
          ui.control({ label: '線の太さ', type: 'range', min: 0, max: 2, step: 0.05, fmt: (v) => `${(+v).toFixed(2)}mm` }, +pxToMm(paper, it.stroke).toFixed(2), live('線の太さ', (v) => { it.stroke = mmToPx(paper, v); })),
          ui.control({ label: 'しっぽの太さ', type: 'range', min: 0.3, max: 3, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` }, it.tailWidth, live('しっぽの太さ', (v) => { it.tailWidth = v; })),
          h('div', { class: 'row' }, it.tail
            ? h('button', { class: 'btn small', onclick: () => { ed.live('しっぽを削除', () => { it.tail = null; }); ui.refreshToolProps(); } }, 'しっぽを削除')
            : h('button', { class: 'btn small', onclick: () => { ed.live('しっぽを追加', () => { it.tail = { x: it.x - it.w * 0.2, y: it.y + it.h * 1.15 }; }); ui.refreshToolProps(); } }, 'しっぽを追加')),
        );
      }
      box.append(h('div', { class: 'row' },
        h('button', { class: 'icon-btn', title: '前面へ', html: icon('up', 18), onclick: () => object.reorder(1) }),
        h('button', { class: 'icon-btn', title: '背面へ', html: icon('down', 18), onclick: () => object.reorder(-1) }),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn small danger', onclick: () => object.remove() }, '削除')));
    },
    layerRow() {
      const pg = page();
      const row = h('div', { class: 'layer-row fixed' + (pg.showItems ? '' : ' hidden-layer') },
        h('button', {
          class: 'icon-btn eye', title: '表示/非表示', html: icon(pg.showItems ? 'eye' : 'eyeOff', 16),
          onclick: (e) => { e.stopPropagation(); pg.showItems = !pg.showItems; ed.ui.refreshLayers(); ed.changed(); },
        }),
        h('span', { class: 'fixed-ic', html: icon('balloon', 18) }),
        h('div', { class: 'layer-name' }, h('div', { class: 'name' }, 'テキスト・フキダシ'), h('div', { class: 'meta' }, `${pg.items.length} 個`)));
      row.addEventListener('click', () => ed.setTool('object'));
      return row;
    },
  };

  return { object, text, balloon };
}
