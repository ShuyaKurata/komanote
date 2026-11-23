// テキストとフキダシ
//
// item = {
//   id, x, y, w, h,            // 枠(ページ座標, 左上と大きさ)
//   text, font, size(px), vertical, bold, lineHeight, letterSpacing, color, outline(白フチ px),
//   shape: 'none'|'ellipse'|'round'|'rect'|'cloud'|'spike',
//   stroke(px), fill, tail: {x,y}|null, tailWidth, autoFit
// }

import { makeCanvas } from './util.js';

// フォント。漫画向けの無料フォント(SIL Open Font License・商用利用可)を Google Fonts から読み込む。
// 読み込めないとき(オフラインで未取得など)は端末に入っている近いフォントで代用する。
// kana/kanji を分けているものは、文字ごとにフォントを切り替える(漫画のセリフの「アンチック体」の組み方)。
const SYS_GOTHIC = '"Hiragino Kaku Gothic ProN","Hiragino Sans","Yu Gothic","YuGothic","Noto Sans JP",sans-serif';
const SYS_MINCHO = '"Hiragino Mincho ProN","Yu Mincho","YuMincho","Noto Serif JP",serif';
export const FONTS = {
  antique: {
    label: 'アンチック(漫画のセリフ)',
    kana: { family: `"Zen Antique",${SYS_MINCHO}`, weight: 400 },
    kanji: { family: `"Zen Kaku Gothic New",${SYS_GOTHIC}`, weight: 700 },
  },
  mincho: { label: '明朝(ナレーション)', family: `"Zen Old Mincho",${SYS_MINCHO}`, weight: 500, boldWeight: 900 },
  gothic: { label: 'ゴシック', family: `"Zen Kaku Gothic New",${SYS_GOTHIC}`, weight: 500, boldWeight: 900 },
  heavy: { label: '極太ゴシック(叫び・効果音)', family: `"Dela Gothic One",${SYS_GOTHIC}`, weight: 400, boldWeight: 400 },
  maru: { label: '丸ゴシック(やわらかいセリフ)', family: `"Zen Maru Gothic","Hiragino Maru Gothic ProN",${SYS_GOTHIC}`, weight: 500, boldWeight: 900 },
  hand: { label: '手書き風(教科書体)', family: `"Klee One",${SYS_MINCHO}`, weight: 600, boldWeight: 600 },
};

/** Google Fonts から読み込む書体(index.html の <link> と同じもの) */
export const WEB_FONT_FAMILIES = ['Zen Antique', 'Zen Kaku Gothic New', 'Zen Old Mincho', 'Dela Gothic One', 'Zen Maru Gothic', 'Klee One'];

export const SHAPES = [
  ['none', 'なし(文字のみ)'],
  ['ellipse', '楕円'],
  ['round', '角丸'],
  ['rect', '長方形(ナレーション)'],
  ['cloud', '雲(思考)'],
  ['spike', 'トゲ(叫び)'],
];

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆〇ヶ]/;
const KANJI_G = new RegExp(KANJI.source, 'g');
// 縦書きで 90° 回転させる文字(長音・ダッシュ・括弧など)
const ROTATE = new Set([...'ー－―‐-–—…‥〜～~「」『』（）()［］[]【】〈〉《》｛｝{}＝=＜＞<>：:；;|｜']);
// 縦書きで右上に寄せる句読点
const PUNCT = new Set([...'、。，．,.']);
// 縦書きで少し右上に寄せる小書きの仮名
const SMALL = new Set([...'ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ']);
// 2 文字までは縦中横(横に並べて 1 マスに収める)
const TCY = /^[0-9!?！？]{2}$/;

function fontFor(item, ch) {
  const def = FONTS[item.font] || FONTS.antique;
  let face = def;
  if (def.kana) face = KANJI.test(ch) ? def.kanji : def.kana;
  const weight = item.bold ? (face.boldWeight || 900) : face.weight;
  return `${weight} ${item.size}px ${face.family}`;
}

// ---------------- Web フォントの読み込み ----------------
// キャンバスに描く文字は、そのフォント(使う文字の分)を読み込み終えてからでないと代用フォントで描かれてしまう。
// 足りないときは読み込みを始め、終わったら onFontsLoaded() で描き直してもらう。
let fontListener = () => {};
const requested = new Set();
export function onFontsLoaded(fn) { fontListener = fn; }

/** item を描くのに必要な [フォント指定, 文字列] の組 */
function fontNeeds(item) {
  const def = FONTS[item.font] || FONTS.antique;
  const text = (item.text || '').replace(/\s/g, '') || 'あ';
  const faces = def.kana ? [[def.kana, text.replace(KANJI_G, '')], [def.kanji, (text.match(KANJI_G) || []).join('')]] : [[def, text]];
  return faces
    .filter(([, t]) => t)
    .map(([face, t]) => [`${item.bold ? (face.boldWeight || 900) : face.weight} 20px ${face.family}`, t]);
}

// どのフォントのどの文字を読み込み済みか覚えておく。document.fonts.check() は日本語フォントだと
// 数百に分かれた部品を毎回調べるので重く、文字入力のたびに呼ぶと iPad で入力が遅れる。
const loadedChars = new Map();
function missingChars(font, text) {
  const set = loadedChars.get(font);
  let m = '';
  for (const ch of new Set(text)) if (!set?.has(ch)) m += ch;
  return m;
}
function markLoaded(font, text) {
  let set = loadedChars.get(font);
  if (!set) loadedChars.set(font, (set = new Set()));
  for (const ch of text) set.add(ch);
}

/** 描く前に呼ぶ。まだ読み込んでいなければ読み込みを始める(待たない) */
function requestFonts(item) {
  if (!document.fonts) return;
  for (const [font, text] of fontNeeds(item)) {
    const miss = missingChars(font, text);
    if (!miss || requested.has(font + miss)) continue;
    requested.add(font + miss);
    document.fonts.load(font, miss).then(() => {
      markLoaded(font, miss);
      itemCache.clear();
      fontListener();
    }).catch(() => {});
  }
}

/** 書き出しの前などに、必要なフォントを読み込み終えるまで待つ。新しく読み込んだら true */
export async function loadFontsFor(items) {
  if (!document.fonts) return false;
  const jobs = [];
  for (const it of items) {
    for (const [font, text] of fontNeeds(it)) {
      const miss = missingChars(font, text);
      if (miss) jobs.push(document.fonts.load(font, miss).then(() => markLoaded(font, miss)).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  return jobs.length > 0;
}

/** 文字の並びを計算する。中心を (0,0) とした座標で返す */
export function layoutText(ctx, item) {
  const s = item.size;
  const lines = (item.text || '').split('\n');
  const glyphs = [];
  if (item.vertical) {
    const colPitch = s * (item.lineHeight || 1.5);
    const charPitch = s * (item.letterSpacing || 1);
    const cols = lines.map((line) => {
      const cells = [];
      const chars = [...line];
      for (let i = 0; i < chars.length; i++) {
        const pair = chars[i] + (chars[i + 1] || '');
        if (TCY.test(pair) && !/[0-9!?！？]/.test(chars[i + 2] || '') && !/[0-9!?！？]/.test(chars[i - 1] || '')) {
          cells.push({ ch: pair, tcy: true });
          i++;
        } else cells.push({ ch: chars[i] });
      }
      return cells;
    });
    const maxLen = Math.max(1, ...cols.map((c) => c.length));
    const n = cols.length;
    const h = maxLen * charPitch;
    const w = (n - 1) * colPitch + s;
    cols.forEach((cells, ci) => {
      const x = ((n - 1) / 2 - ci) * colPitch;
      cells.forEach((cell, j) => {
        const y = -h / 2 + (j + 0.5) * charPitch;
        const g = { ch: cell.ch, x, y, rot: 0, font: fontFor(item, cell.ch[0]), sx: 1 };
        if (cell.tcy) g.sx = 0.5;
        else if (ROTATE.has(cell.ch)) g.rot = Math.PI / 2;
        else if (PUNCT.has(cell.ch)) { g.x += s * 0.58; g.y -= s * 0.58; }
        else if (SMALL.has(cell.ch)) { g.x += s * 0.1; g.y -= s * 0.1; }
        glyphs.push(g);
      });
    });
    return { glyphs, w, h };
  }
  // 横書き
  const linePitch = s * (item.lineHeight || 1.5) * 0.85;
  const rows = lines.map((line) => {
    let x = 0;
    const cells = [...line].map((ch) => {
      ctx.font = fontFor(item, ch);
      const adv = ctx.measureText(ch).width * (item.letterSpacing || 1);
      const c = { ch, x: x + adv / 2, font: ctx.font };
      x += adv;
      return c;
    });
    return { cells, width: x };
  });
  const w = Math.max(s, ...rows.map((r) => r.width));
  const h = (rows.length - 1) * linePitch + s;
  rows.forEach((r, ri) => {
    const y = -h / 2 + s / 2 + ri * linePitch;
    for (const c of r.cells) glyphs.push({ ch: c.ch, x: c.x - r.width / 2, y, rot: 0, font: fontFor(item, c.ch), sx: 1 });
  });
  return { glyphs, w, h };
}

function drawGlyphs(ctx, glyphs, fn) {
  for (const g of glyphs) {
    ctx.save();
    ctx.translate(g.x, g.y);
    if (g.rot) ctx.rotate(g.rot);
    if (g.sx !== 1) ctx.scale(g.sx, 1);
    ctx.font = g.font;
    fn(g);
    ctx.restore();
  }
}

// ---------------- フキダシの形 ----------------
function hashSeed(str) {
  let x = 2166136261;
  for (const c of str) x = Math.imul(x ^ c.charCodeAt(0), 16777619);
  return () => {
    x = Math.imul(x ^ (x >>> 15), 2246822507);
    x = Math.imul(x ^ (x >>> 13), 3266489909);
    return ((x ^= x >>> 16) >>> 0) / 4294967296;
  };
}

export function balloonPath(item) {
  const { x, y, w, h, shape } = item;
  const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
  const p = new Path2D();
  if (shape === 'ellipse') p.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  else if (shape === 'rect') p.rect(x, y, w, h);
  else if (shape === 'round') {
    const r = Math.min(w, h) * 0.22;
    p.moveTo(x + r, y);
    p.arcTo(x + w, y, x + w, y + h, r);
    p.arcTo(x + w, y + h, x, y + h, r);
    p.arcTo(x, y + h, x, y, r);
    p.arcTo(x, y, x + w, y, r);
    p.closePath();
  } else if (shape === 'cloud') {
    const per = Math.PI * (rx + ry);
    const n = Math.max(8, Math.round(per / (Math.min(w, h) * 0.32)));
    const pt = (a, k = 1) => [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k];
    const [sx, sy] = pt(0, 0.92);
    p.moveTo(sx, sy);
    for (let i = 0; i < n; i++) {
      const a1 = ((i + 0.5) / n) * Math.PI * 2, a2 = ((i + 1) / n) * Math.PI * 2;
      const [qx, qy] = pt(a1, 1.18);
      const [ex, ey] = pt(a2, 0.92);
      p.quadraticCurveTo(qx, qy, ex, ey);
    }
    p.closePath();
  } else if (shape === 'spike') {
    const rnd = hashSeed(item.id);
    const n = Math.max(14, Math.round((Math.PI * (rx + ry)) / (Math.min(w, h) * 0.18)));
    for (let i = 0; i < n * 2; i++) {
      const a = (i / (n * 2)) * Math.PI * 2;
      const k = i % 2 === 0 ? 1.08 + rnd() * 0.22 : 0.8 + rnd() * 0.06;
      const px = cx + Math.cos(a) * rx * k, py = cy + Math.sin(a) * ry * k;
      if (i) p.lineTo(px, py); else p.moveTo(px, py);
    }
    p.closePath();
  }
  return p;
}

function tailPath(item) {
  const t = item.tail;
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  const dx = t.x - cx, dy = t.y - cy, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  const bw = Math.min(item.w, item.h) * 0.13 * (item.tailWidth || 1);
  // 根元をフキダシの中心付近に置き、本体と重ねて塗ることで継ぎ目を消す
  const bx = cx + (dx / len) * Math.min(item.w, item.h) * 0.2, by = cy + (dy / len) * Math.min(item.w, item.h) * 0.2;
  const p = new Path2D();
  p.moveTo(bx + nx * bw, by + ny * bw);
  p.quadraticCurveTo((bx + t.x) / 2 + nx * bw * 0.25, (by + t.y) / 2 + ny * bw * 0.25, t.x, t.y);
  p.quadraticCurveTo((bx + t.x) / 2 - nx * bw * 0.25, (by + t.y) / 2 - ny * bw * 0.25, bx - nx * bw, by - ny * bw);
  p.closePath();
  return p;
}

/** 思考フキダシのしっぽ(小さな丸の連なり) */
function thoughtBubbles(item) {
  const t = item.tail;
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  const dx = t.x - cx, dy = t.y - cy, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  // 楕円の縁の位置
  const edge = 1 / Math.sqrt((ux * ux) / ((item.w / 2) ** 2) + (uy * uy) / ((item.h / 2) ** 2));
  const r0 = Math.min(item.w, item.h) * 0.09;
  const start = edge * 1.12, span = Math.max(0, len - start);
  return [0.15, 0.55, 0.92].map((k, i) => ({ x: cx + ux * (start + span * k), y: cy + uy * (start + span * k), r: r0 * (1 - i * 0.28) }));
}

export function drawBalloon(ctx, item) {
  if (item.shape === 'none') return;
  const body = balloonPath(item);
  const sw = item.stroke;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#000';
  ctx.fillStyle = item.fill || '#fff';
  const hasTail = item.tail && item.shape !== 'cloud';
  const tail = hasTail ? tailPath(item) : null;
  // 1) 太い線(2倍)で輪郭を描き、2) 白で内側を塗ると、本体としっぽが一体化した線だけが残る
  if (sw > 0) {
    ctx.lineWidth = sw * 2;
    ctx.stroke(body);
    if (tail) ctx.stroke(tail);
  }
  ctx.fill(body);
  if (tail) ctx.fill(tail);
  if (item.tail && item.shape === 'cloud') {
    ctx.lineWidth = sw;
    for (const b of thoughtBubbles(item)) {
      const c = new Path2D();
      c.ellipse(b.x, b.y, b.r * 1.25, b.r, 0, 0, Math.PI * 2);
      ctx.fill(c);
      if (sw > 0) ctx.stroke(c);
    }
  }
  ctx.restore();
}

/** @param quiet true ならフォントの読み込みを始めない(入力中のプレビューなど。呼ぶ側で loadFontsFor を使う) */
export function drawItem(ctx, item, quiet = false) {
  if (!quiet) requestFonts(item);
  drawBalloon(ctx, item);
  if (!item.text) return;
  const lay = layoutText(ctx, item);
  ctx.save();
  ctx.translate(item.x + item.w / 2, item.y + item.h / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (item.outline > 0) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = item.outline * 2;
    ctx.lineJoin = 'round';
    drawGlyphs(ctx, lay.glyphs, (g) => ctx.strokeText(g.ch, 0, 0));
  }
  ctx.fillStyle = item.color || '#000';
  drawGlyphs(ctx, lay.glyphs, (g) => ctx.fillText(g.ch, 0, 0));
  ctx.restore();
}

// 画面表示用の画像キャッシュ。縦書きは 1 文字ずつフォントを設定して描くので重く、
// 毎フレーム組み直すと iPad では描画が追いつかない。内容が変わったときだけ描き直す。
const itemCache = new Map();

function itemBounds(item) {
  const pad = Math.max(item.w, item.h) * (item.shape === 'spike' ? 0.25 : item.shape === 'cloud' ? 0.15 : 0.04)
    + (item.stroke || 0) * 2 + (item.outline || 0) * 2 + item.size;
  let x1 = item.x - pad, y1 = item.y - pad, x2 = item.x + item.w + pad, y2 = item.y + item.h + pad;
  if (item.tail) {
    x1 = Math.min(x1, item.tail.x - pad); y1 = Math.min(y1, item.tail.y - pad);
    x2 = Math.max(x2, item.tail.x + pad); y2 = Math.max(y2, item.tail.y + pad);
  }
  return { x: Math.floor(x1), y: Math.floor(y1), w: Math.ceil(x2 - x1), h: Math.ceil(y2 - y1) };
}

function cachedItem(item) {
  const key = JSON.stringify(item);
  let c = itemCache.get(item.id);
  if (c && c.key === key) return c;
  const b = itemBounds(item);
  if (b.w * b.h > 6e6) return null; // 大きすぎるものはキャッシュしない
  const canvas = c?.canvas || makeCanvas(1, 1);
  canvas.width = Math.max(1, b.w);
  canvas.height = Math.max(1, b.h);
  const x = canvas.getContext('2d');
  x.translate(-b.x, -b.y);
  drawItem(x, item);
  c = { key, canvas, b };
  itemCache.set(item.id, c);
  return c;
}

export function drawItems(ctx, project, page, useCache = false) {
  if (!page.showItems) return;
  for (const it of page.items) {
    const c = useCache ? cachedItem(it) : null;
    if (c) ctx.drawImage(c.canvas, c.b.x, c.b.y);
    else drawItem(ctx, it);
  }
  if (useCache && itemCache.size > page.items.length + 50) {
    const ids = new Set(page.items.map((i) => i.id));
    for (const [id, c] of itemCache) if (!ids.has(id)) { c.canvas.width = 0; itemCache.delete(id); }
  }
}

let measureCtx = null;
/** 文字に合わせてフキダシの大きさを決める(中心は変えない) */
export function fitItemToText(item) {
  measureCtx ||= makeCanvas(4, 4).getContext('2d');
  const lay = layoutText(measureCtx, item);
  const s = item.size;
  const round = item.shape === 'ellipse' || item.shape === 'cloud' || item.shape === 'spike';
  const k = round ? (item.shape === 'spike' ? 1.65 : 1.5) : 1;
  const pad = item.shape === 'none' ? s * 0.2 : s * (round ? 0.5 : 1.0);
  const w = Math.max(s * 1.5, lay.w * k + pad * 2);
  const h = Math.max(s * 1.5, lay.h * k + pad * 2);
  const cx = item.x + item.w / 2, cy = item.y + item.h / 2;
  Object.assign(item, { x: cx - w / 2, y: cy - h / 2, w, h });
}

export function hitItem(items, x, y) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) return it;
  }
  return null;
}
