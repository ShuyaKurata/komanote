// ブラシエンジン
//
// 仕組み:
//  1. ストローク開始時にレイヤーの内容を backup に退避する
//  2. ストロークは不透明のまま buffer に描く(円スタンプを等間隔に並べる)
//  3. 変更された範囲だけ「backup + buffer×不透明度」でレイヤーを作り直す
//     → 半透明のペンでも重なった部分が濃くならない(1 ストローク内で均一)
//  4. 終了時に backup と現在のレイヤーから変更範囲の ImageData を取り、取り消し用の履歴にする
//
// 手ブレ補正: 入力点を一定割合だけ追いかける「遅延追従」方式。
// 入り抜き:   距離に応じて太さを絞る。抜きは終了時にストローク全体を描き直して適用する。

import { makeCanvas, rectUnion, clipRect } from './util.js';

let grainSrc = null;
function grainCanvas() {
  if (grainSrc) return grainSrc;
  const c = makeCanvas(96, 96), x = c.getContext('2d');
  const img = x.createImageData(96, 96);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random();
    img.data[i + 3] = v < 0.3 ? 0 : Math.round(120 + v * 135);
  }
  x.putImageData(img, 0, 0);
  return (grainSrc = c);
}

export class StrokeEngine {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.backup = makeCanvas(w, h);
    this.buffer = makeCanvas(w, h);
    this.bctx = this.buffer.getContext('2d');
    this.tmp = makeCanvas(256, 256);
    this.softStamp = null;
    this.softColor = null;
    this.active = false;
  }

  release() {
    for (const c of [this.backup, this.buffer, this.tmp]) { c.width = 0; c.height = 0; }
  }

  /**
   * @param layer   描画先レイヤー
   * @param brush   {size, opacity, pressure, minSize, taperIn, taperOut, stabilize, soft, flow, grain, erase}
   * @param color   '#rrggbb'
   * @param clip    選択範囲(Path2D)。null なら全体
   */
  begin(layer, brush, color, clip = null) {
    this.layer = layer;
    this.ctx = layer.canvas.getContext('2d');
    this.brush = brush;
    this.color = color;
    this.clip = clip;
    const b = this.backup.getContext('2d');
    b.clearRect(0, 0, this.w, this.h);
    b.drawImage(layer.canvas, 0, 0);
    this.bctx.clearRect(0, 0, this.w, this.h);
    this.pts = [];
    this.bbox = null;
    this.total = 0;
    this.nextStamp = 0;
    this.smooth = null;
    this.raw = null;
    this.k = brush.stabilize > 0 ? 1 - 1 / (1 + brush.stabilize * 0.35) : 0;
    if (brush.soft) this.prepareSoft(color);
    this.active = true;
  }

  prepareSoft(color) {
    if (this.softStamp && this.softColor === color) return;
    const s = 128, c = makeCanvas(s, s), x = c.getContext('2d');
    const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.5, color + 'aa');
    g.addColorStop(1, color + '00');
    x.fillStyle = g;
    x.fillRect(0, 0, s, s);
    this.softStamp = c;
    this.softColor = color;
  }

  addPoint(x, y, p) {
    if (!this.active) return;
    this.raw = { x, y, p };
    if (!this.smooth) {
      this.smooth = { x, y, p };
      this.push(x, y, p);
      return;
    }
    const s = this.smooth, k = this.k;
    s.x += (x - s.x) * (1 - k);
    s.y += (y - s.y) * (1 - k);
    s.p += (p - s.p) * (1 - Math.min(k, 0.5));
    const last = this.pts[this.pts.length - 1];
    if (Math.hypot(s.x - last.x, s.y - last.y) < 0.35) { last.p = Math.max(last.p, s.p); return; }
    this.push(s.x, s.y, s.p);
  }

  push(x, y, p) {
    const last = this.pts[this.pts.length - 1];
    if (last) this.total += Math.hypot(x - last.x, y - last.y);
    this.pts.push({ x, y, p, d: this.total });
    const r = this.stampSegment(this.pts.length - 1, false);
    if (r) this.recompose(r);
  }

  radius(p, d, taperOut) {
    const b = this.brush;
    let f = 1;
    if (b.pressure) f *= b.minSize + (1 - b.minSize) * p;
    if (b.taperIn > 0) f *= Math.min(1, 0.08 + d / (b.taperIn * b.size * 12));
    if (taperOut && b.taperOut > 0) f *= Math.min(1, 0.08 + (this.total - d) / (b.taperOut * b.size * 12));
    return Math.max(0.35, (b.size * f) / 2);
  }

  /** pts[i-1] → pts[i] の区間にスタンプを打つ。変更範囲を返す */
  stampSegment(i, taperOut) {
    const b = this.brush, ctx = this.bctx, pts = this.pts;
    const cur = pts[i], prev = pts[i - 1];
    const spacingK = b.soft ? 0.12 : 0.22;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const hard = !b.soft;
    if (hard) { ctx.fillStyle = this.color; ctx.beginPath(); }
    const stamp = (x, y, p, d) => {
      const r = this.radius(p, d, taperOut);
      if (hard) {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, Math.PI * 2);
      } else {
        ctx.globalAlpha = Math.min(1, (b.flow ?? 0.2) * (b.pressure ? 0.3 + 0.7 * p : 1));
        ctx.drawImage(this.softStamp, x - r, y - r, r * 2, r * 2);
      }
      minX = Math.min(minX, x - r); minY = Math.min(minY, y - r);
      maxX = Math.max(maxX, x + r); maxY = Math.max(maxY, y + r);
      return r;
    };
    if (!prev) {
      const r = stamp(cur.x, cur.y, cur.p, 0);
      this.nextStamp = Math.max(0.4, r * spacingK);
    } else {
      const seg = cur.d - prev.d;
      let pos = this.nextStamp;
      while (pos <= cur.d) {
        const t = seg > 0 ? (pos - prev.d) / seg : 1;
        const r = stamp(
          prev.x + (cur.x - prev.x) * t,
          prev.y + (cur.y - prev.y) * t,
          prev.p + (cur.p - prev.p) * t,
          pos,
        );
        pos += Math.max(0.4, r * spacingK);
      }
      this.nextStamp = pos;
    }
    if (hard) ctx.fill();
    ctx.globalAlpha = 1;
    if (minX === Infinity) return null;
    const r = { x: minX - 2, y: minY - 2, w: maxX - minX + 4, h: maxY - minY + 4 };
    this.bbox = rectUnion(this.bbox, r);
    return r;
  }

  /** 指定範囲のレイヤーを backup + buffer で作り直す */
  recompose(rect) {
    const r = clipRect(rect, this.w, this.h);
    if (!r) return;
    const { x, y, w, h } = r, c = this.ctx, b = this.brush;
    c.save();
    c.clearRect(x, y, w, h);
    c.drawImage(this.backup, x, y, w, h, x, y, w, h);
    c.beginPath();
    c.rect(x, y, w, h);
    c.clip();
    if (this.clip) c.clip(this.clip);
    c.globalAlpha = b.opacity;
    c.globalCompositeOperation = b.erase ? 'destination-out' : 'source-over';
    if (b.grain) {
      if (this.tmp.width < w || this.tmp.height < h) {
        this.tmp.width = Math.max(this.tmp.width, w);
        this.tmp.height = Math.max(this.tmp.height, h);
      }
      const t = this.tmp.getContext('2d');
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, w, h);
      t.drawImage(this.buffer, x, y, w, h, 0, 0, w, h);
      t.globalCompositeOperation = 'destination-in';
      const pat = t.createPattern(grainCanvas(), 'repeat');
      pat.setTransform?.(new DOMMatrix().translate(-x, -y));
      t.fillStyle = pat;
      t.fillRect(0, 0, w, h);
      t.globalCompositeOperation = 'source-over';
      c.drawImage(this.tmp, 0, 0, w, h, x, y, w, h);
    } else {
      c.drawImage(this.buffer, x, y, w, h, x, y, w, h);
    }
    c.restore();
  }

  /** ストローク終了。取り消し用の {rect, before, after} を返す(何も描いていなければ null) */
  end() {
    if (!this.active) return null;
    // 手ブレ補正で遅れている分を最終点まで追いつかせる
    if (this.k > 0 && this.raw && this.smooth) {
      for (let n = 0; n < 60; n++) {
        if (Math.hypot(this.raw.x - this.smooth.x, this.raw.y - this.smooth.y) < 0.5) break;
        this.addPoint(this.raw.x, this.raw.y, this.raw.p);
      }
    }
    // 抜き: ストローク全体を描き直す
    if (this.brush.taperOut > 0 && this.pts.length > 1 && this.bbox) {
      const r = clipRect(this.bbox, this.w, this.h);
      if (r) this.bctx.clearRect(r.x, r.y, r.w, r.h);
      for (let i = 0; i < this.pts.length; i++) this.stampSegment(i, true);
    }
    this.active = false;
    const r = clipRect(this.bbox, this.w, this.h);
    if (!r) return null;
    this.recompose(r);
    return {
      rect: r,
      before: this.backup.getContext('2d').getImageData(r.x, r.y, r.w, r.h),
      after: this.ctx.getImageData(r.x, r.y, r.w, r.h),
    };
  }

  /** ストロークを取り消して元に戻す(2 本指ジェスチャーに切り替わったときなど) */
  abort() {
    if (!this.active) return;
    this.active = false;
    const r = clipRect(this.bbox, this.w, this.h);
    if (!r) return;
    this.ctx.clearRect(r.x, r.y, r.w, r.h);
    this.ctx.drawImage(this.backup, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  }
}
