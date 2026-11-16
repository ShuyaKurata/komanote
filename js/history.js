// 取り消し/やり直し
// 各エントリは { label, undo(), redo(), bytes } を持つ。
// 画素の履歴は変更した範囲だけを ImageData で持ち、合計がメモリ上限を超えたら古いものから捨てる。

export class History {
  constructor({ limit = 80, maxBytes = 320 * 1024 * 1024, onChange = () => {} } = {}) {
    this.limit = limit;
    this.maxBytes = maxBytes;
    this.onChange = onChange;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  push(entry) {
    entry.bytes ||= 0;
    this.undoStack.push(entry);
    this.redoStack = [];
    this.trim();
    this.onChange();
  }

  trim() {
    const total = () => this.undoStack.reduce((s, e) => s + e.bytes, 0);
    while (this.undoStack.length > this.limit) this.undoStack.shift();
    while (this.undoStack.length > 1 && total() > this.maxBytes) this.undoStack.shift();
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return null;
    e.undo();
    this.redoStack.push(e);
    this.onChange();
    return e;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return null;
    e.redo();
    this.undoStack.push(e);
    this.onChange();
    return e;
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange();
  }
}

/**
 * レイヤーの一部の画素を書き換えた履歴。
 * before/after は ImageData か、同じ大きさのキャンバス。キャンバスは compact() で ImageData に変換して手放す
 * (iOS の Safari はキャンバスに使えるメモリの上限が小さいため、長く持たない)。
 */
export function rasterEntry(label, layer, rect, before, after, onApply) {
  const isCanvas = (x) => typeof HTMLCanvasElement !== 'undefined' && x instanceof HTMLCanvasElement;
  const data = { before, after };
  const put = (img) => {
    if (!layer.canvas) return;
    const ctx = layer.canvas.getContext('2d');
    if (isCanvas(img)) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
      ctx.drawImage(img, rect.x, rect.y);
      ctx.restore();
    } else ctx.putImageData(img, rect.x, rect.y);
    layer.dirty = true;
    onApply(layer);
  };
  const toData = (c) => {
    if (!isCanvas(c)) return c;
    const img = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    c.width = 0; c.height = 0;
    return img;
  };
  return {
    label,
    bytes: rect.w * rect.h * 8,
    undo: () => put(data.before),
    redo: () => put(data.after),
    /** キャンバスで持っている分を ImageData に変換する。変換したら true */
    compact() {
      if (!isCanvas(data.before) && !isCanvas(data.after)) return false;
      data.before = toData(data.before);
      data.after = toData(data.after);
      return true;
    },
  };
}
