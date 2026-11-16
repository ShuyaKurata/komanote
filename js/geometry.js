// 幾何計算(コマ枠の分割など)。多角形は [[x,y], ...] の配列。

const cross = (ax, ay, bx, by) => ax * by - ay * bx;

/** 凸多角形を半平面 nx*x + ny*y >= c で切り取る(Sutherland–Hodgman 法) */
export function clipPolygon(poly, nx, ny, c) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

export function polygonArea(poly) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 直線 a + t(b-a) が多角形と交わる t の範囲 [tmin, tmax]。交わらなければ null */
export function lineChord(poly, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ts = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = cross(dx, dy, ex, ey);
    if (Math.abs(den) < 1e-9) continue;
    const t = cross(p[0] - a.x, p[1] - a.y, ex, ey) / den;
    const s = cross(p[0] - a.x, p[1] - a.y, dx, dy) / den;
    if (s >= -1e-9 && s <= 1 + 1e-9) ts.push(t);
  }
  if (ts.length < 2) return null;
  return [Math.min(...ts), Math.max(...ts)];
}

/**
 * 線分 a→b でコマを 2 つに分ける。gap は分割後のすき間の幅。
 * 線分がコマの中を通っていなければ null。
 */
export function splitPolygon(poly, a, b, gap) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1) return null;
  const chord = lineChord(poly, a, b);
  // ドラッグした線分(t=0..1)がコマの内部(chord)と重なっているか
  if (!chord || chord[1] <= 0 || chord[0] >= 1) return null;
  const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
  const c = nx * a.x + ny * a.y;
  const p1 = clipPolygon(poly, nx, ny, c + gap / 2);
  const p2 = clipPolygon(poly, -nx, -ny, -(c - gap / 2));
  if (p1.length < 3 || p2.length < 3) return null;
  const min = Math.max(64, gap * gap);
  if (polygonArea(p1) < min || polygonArea(p2) < min) return null;
  return [p1, p2];
}

export function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export const rectPoly = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export function polyBounds(poly) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of poly) {
    x1 = Math.min(x1, x); y1 = Math.min(y1, y);
    x2 = Math.max(x2, x); y2 = Math.max(y2, y);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export function polyToPath(poly, path = new Path2D()) {
  poly.forEach(([x, y], i) => (i ? path.lineTo(x, y) : path.moveTo(x, y)));
  path.closePath();
  return path;
}

/** 角度を水平・垂直・45°にスナップする */
export function snapAngle(a, b, tolDeg = 4) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
  for (const t of [0, 45, 90, 135, 180, -45, -90, -135, -180]) {
    if (Math.abs(ang - t) < tolDeg) {
      const r = (t * Math.PI) / 180;
      return { x: a.x + Math.cos(r) * len, y: a.y + Math.sin(r) * len };
    }
  }
  return b;
}
