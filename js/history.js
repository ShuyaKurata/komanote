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

/** レイヤーの一部の画素を書き換えた履歴 */
export function rasterEntry(label, layer, rect, before, after, onApply) {
  const put = (img) => {
    if (!layer.canvas) return;
    layer.canvas.getContext('2d').putImageData(img, rect.x, rect.y);
    layer.dirty = true;
    onApply(layer);
  };
  return {
    label,
    bytes: before.data.length + after.data.length,
    undo: () => put(before),
    redo: () => put(after),
  };
}
