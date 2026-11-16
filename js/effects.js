// 塗りつぶし・トーン(網点)・集中線・流線

import { makeCanvas } from './util.js';

/**
 * 塗りつぶす範囲(マスク)を求める。
 * @param img       参照する画像 (ImageData)
 * @param tolerance 色の許容誤差 0〜100
 * @param expand    範囲を広げるピクセル数(線との境目の隙間を埋める)
 * @returns {{mask:Uint8Array, bbox}|null}
 */
export function floodMask(img, sx, sy, tolerance, expand = 1) {
  const { width: w, height: h, data } = img;
  sx = Math.floor(sx); sy = Math.floor(sy);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
  const i0 = (sy * w + sx) * 4;
  const r0 = data[i0], g0 = data[i0 + 1], b0 = data[i0 + 2], a0 = data[i0 + 3];
  const tol = (tolerance / 100) * 255;
  const same = (i) => {
    const j = i * 4;
    return Math.abs(data[j] - r0) <= tol && Math.abs(data[j + 1] - g0) <= tol &&
      Math.abs(data[j + 2] - b0) <= tol && Math.abs(data[j + 3] - a0) <= tol;
  };
  const mask = new Uint8Array(w * h);
  let minX = sx, maxX = sx, minY = sy, maxY = sy;
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop(), x0 = stack.pop();
    let x = x0;
    while (x >= 0 && !mask[y * w + x] && same(y * w + x)) x--;
    x++;
    let upOpen = false, downOpen = false;
    while (x < w && !mask[y * w + x] && same(y * w + x)) {
      mask[y * w + x] = 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y > 0) {
        const up = !mask[(y - 1) * w + x] && same((y - 1) * w + x);
        if (up && !upOpen) stack.push(x, y - 1);
        upOpen = up;
      }
      if (y < h - 1) {
        const dn = !mask[(y + 1) * w + x] && same((y + 1) * w + x);
        if (dn && !downOpen) stack.push(x, y + 1);
        downOpen = dn;
      }
      x++;
    }
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // 領域拡張(隣接 8 方向に expand 回広げる)
  for (let n = 0; n < expand; n++) {
    const x1 = Math.max(0, minX - 1), x2 = Math.min(w - 1, maxX + 1);
    const y1 = Math.max(0, minY - 1), y2 = Math.min(h - 1, maxY + 1);
    const add = [];
    for (let y = y1; y <= y2; y++) {
      for (let x = x1; x <= x2; x++) {
        const i = y * w + x;
        if (mask[i]) continue;
        if ((x > 0 && mask[i - 1]) || (x < w - 1 && mask[i + 1]) || (y > 0 && mask[i - w]) || (y < h - 1 && mask[i + w])) add.push(i);
      }
    }
    for (const i of add) mask[i] = 1;
    minX = x1; maxX = x2; minY = y1; maxY = y2;
  }
  return { mask, bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
}

/** マスクの範囲をキャンバスにする(白=塗る) */
export function maskToCanvas(mask, w, bbox) {
  const c = makeCanvas(bbox.w, bbox.h);
  const ctx = c.getContext('2d');
  const out = ctx.createImageData(bbox.w, bbox.h);
  for (let y = 0; y < bbox.h; y++) {
    const row = (bbox.y + y) * w + bbox.x;
    for (let x = 0; x < bbox.w; x++) {
      if (mask[row + x]) out.data[(y * bbox.w + x) * 4 + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

/**
 * 網点トーンのパターン
 * @param lpi     線数(1 インチあたりの点の列数) 一般的な漫画は 50〜70
 * @param density 濃度 0〜1
 * @param angle   角度(度) 一般的には 45°
 */
export function tonePattern(ctx, { dpi, lpi, density, angle, color = '#000000' }) {
  const cell = Math.max(2, dpi / lpi);
  const n = 4;
  const size = Math.max(4, Math.round(cell * n));
  const c = makeCanvas(size, size);
  const x = c.getContext('2d');
  const step = size / n;
  x.fillStyle = color;
  if (density >= 0.5) {
    // 濃い場合は「白い点の抜き」として描くほうが網点らしい
    x.fillRect(0, 0, size, size);
    x.globalCompositeOperation = 'destination-out';
  }
  const d = density >= 0.5 ? 1 - density : density;
  const r = step * Math.sqrt(d / Math.PI);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      x.beginPath();
      x.arc((i + 0.5) * step, (j + 0.5) * step, r, 0, Math.PI * 2);
      x.fill();
    }
  }
  const pat = ctx.createPattern(c, 'repeat');
  pat.setTransform?.(new DOMMatrix().rotate(angle));
  return pat;
}

/** 範囲(Path2D またはマスクキャンバス)を色またはトーンで塗った画像を作る */
export function paintCanvas(w, h, paint, project) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  if (paint.type === 'tone') ctx.fillStyle = tonePattern(ctx, { dpi: project.paper.dpi, ...paint, color: paint.color });
  else ctx.fillStyle = paint.color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

// ---------------- 集中線・流線 ----------------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = Math.imul(s ^ (s >>> 15), 1 | s) + 0x6d2b79f5) >>> 0) / 4294967296;
}

/**
 * 集中線: 中心の楕円(rx, ry)の外側から、外へ向かって太くなる線を放射状に描く
 */
export function drawFocusLines(ctx, { cx, cy, rx, ry, outer, count, width, jitter, color, seed = Date.now() }) {
  const rand = rng(seed);
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const a = ((i + rand() * 0.8) / count) * Math.PI * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    const inner = 1 + rand() * jitter * 1.2;
    const sx = cx + cos * rx * inner, sy = cy + sin * ry * inner;
    const ex = cx + cos * outer, ey = cy + sin * outer;
    const bw = width * (0.4 + rand() * 0.9) / 2;
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex - sin * bw * 3, ey + cos * bw * 3);
    ctx.lineTo(ex + sin * bw * 3, ey - cos * bw * 3);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

/**
 * 流線: 方向 (ux, uy) に平行な、両端が細い線を範囲 bounds 内にばらまく
 */
export function drawSpeedLines(ctx, { ax, ay, bx, by, bounds, count, width, jitter, color, seed = Date.now() }) {
  const rand = rng(seed);
  const len = Math.hypot(bx - ax, by - ay) || 1;
  const ux = (bx - ax) / len, uy = (by - ay) / len;
  const nx = -uy, ny = ux;
  const { x, y, w, h } = bounds;
  const diag = Math.hypot(w, h);
  const cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const off = (rand() - 0.5) * diag;
    const along = (rand() - 0.5) * diag;
    const L = len * (1 - jitter * 0.7 * rand());
    const mx = cx + nx * off + ux * along, my = cy + ny * off + uy * along;
    const sx = mx - ux * L / 2, sy = my - uy * L / 2;
    const ex = mx + ux * L / 2, ey = my + uy * L / 2;
    const bw = (width * (0.4 + rand() * 0.8)) / 2;
    ctx.moveTo(sx, sy);
    ctx.quadraticCurveTo(mx + nx * bw * 2, my + ny * bw * 2, ex, ey);
    ctx.quadraticCurveTo(mx - nx * bw * 2, my - ny * bw * 2, sx, sy);
    ctx.closePath();
  }
  ctx.fill();
  ctx.restore();
}

