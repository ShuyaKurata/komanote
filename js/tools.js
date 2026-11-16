// ツールの動作(kind ごとの実装)
// 各ツールは { down(p), move(p), up(p), cancel(), overlay(ctx, px), hoverCursor } を持つ。
// p = { x, y (ページ座標), sx, sy (画面座標), pressure, pointerType }

import { makeCanvas, rgbToHex } from './util.js';
import { renderPage } from './render.js';
import { panelTool } from './panels.js';
import { createTextTools } from './text-tools.js';
import { createPaintTools } from './paint-tools.js';

export function createTools(ed) {
  // 並び順はレイヤーパレット上部の固定行の順にもなる(テキスト → コマ枠)
  return {
    ...createTextTools(ed),
    hand: handTool(ed),
    brush: brushTool(ed),
    eyedropper: eyedropperTool(ed),
    panel: panelTool(ed),
    ...createPaintTools(ed),
  };
}

function handTool(ed) {
  let anchor = null;
  return {
    cursor: 'grab',
    down(p) { anchor = { x: p.x, y: p.y }; },
    move(p) {
      if (!anchor) return;
      ed.anchorView(anchor, { x: p.sx, y: p.sy });
    },
    up() { anchor = null; },
    cancel() { anchor = null; },
  };
}

function brushTool(ed) {
  let drawing = false;
  let layer = null;
  return {
    cursor: 'none',
    showBrushCursor: true,
    down(p) {
      layer = ed.editableLayer();
      if (!layer) return;
      const s = ed.settings();
      const erase = s.erase || ed.color.transparent;
      ed.engine.begin(layer, { ...s, erase }, ed.currentColor(), ed.selectionPath());
      ed.beginStrokeView(layer);
      ed.engine.addPoint(p.x, p.y, p.pressure);
      drawing = true;
      ed.requestRender();
    },
    move(p) {
      if (!drawing) return;
      ed.engine.addPoint(p.x, p.y, p.pressure);
      ed.requestRender();
    },
    up() {
      if (!drawing) return;
      drawing = false;
      const res = ed.engine.end();
      ed.render(); // 最後の部分を差分描画で反映してから通常表示に戻す
      ed.endStrokeView();
      if (res) ed.pushRaster('描画', layer, res.rect, res.before, res.after);
    },
    cancel() {
      if (!drawing) return;
      drawing = false;
      ed.engine.abort();
      ed.endStrokeView();
    },
  };
}

function eyedropperTool(ed) {
  const one = makeCanvas(1, 1);
  const pick = (p) => {
    const ctx = one.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, 1, 1);
    ctx.setTransform(1, 0, 0, 1, -Math.floor(p.x), -Math.floor(p.y));
    const s = ed.settings();
    if (s.src === 'layer') {
      const L = ed.layer;
      if (L?.canvas) ctx.drawImage(L.canvas, 0, 0);
    } else {
      renderPage(ctx, ed.project, ed.page, { guides: false });
    }
    const d = ctx.getImageData(0, 0, 1, 1).data;
    if (d[3] < 10) {
      if (s.src === 'layer') ed.setTransparent(true);
      return;
    }
    ed.setColor(rgbToHex(d[0], d[1], d[2]));
  };
  return {
    cursor: 'crosshair',
    down: pick,
    move: pick,
    up() {},
    cancel() {},
  };
}
