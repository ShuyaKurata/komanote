// 用紙サイズのプリセット(単位 mm)
// trim = 仕上がり / bleed = 裁ち落とし幅 / frame = 基本枠 / margin = 裁ち落としの外側の余白

export const PRESETS = [
  { id: 'b4-toukou', label: 'B4 投稿原稿(仕上がり 220×310mm)', paperW: 257, paperH: 364, trimW: 220, trimH: 310, bleed: 5, frameW: 180, frameH: 270 },
  { id: 'b5-doujin', label: 'B5 同人誌(182×257mm)', trimW: 182, trimH: 257, bleed: 3, frameW: 150, frameH: 220, margin: 7 },
  { id: 'a4', label: 'A4(210×297mm)', trimW: 210, trimH: 297, bleed: 3, frameW: 170, frameH: 255, margin: 7 },
  { id: 'a5', label: 'A5 同人誌(148×210mm)', trimW: 148, trimH: 210, bleed: 3, frameW: 120, frameH: 180, margin: 7 },
  { id: 'webtoon', label: 'Webtoon 縦読み(800×6000px)', px: true, w: 800, h: 6000 },
  { id: 'custom', label: 'カスタム(仕上がりサイズを指定)', custom: true },
];

export const DPI_OPTIONS = [
  { value: 150, label: '150dpi(軽い・ラフ向け)' },
  { value: 200, label: '200dpi(標準・おすすめ)' },
  { value: 300, label: '300dpi(高精細・メモリ多め)' },
];

const centered = (W, H, w, h) => ({ x: (W - w) / 2, y: (H - h) / 2, w, h });

/**
 * プリセットから原稿サイズ(px)を計算する
 * @returns {{presetId,label,dpi,w,h,trim,bleed,frame}}
 */
export function buildPaper(presetId, dpi = 200, custom = {}) {
  let p = PRESETS.find((x) => x.id === presetId) || PRESETS[1];
  if (p.px) {
    // Webtoon はピクセル指定。テキストの pt 換算用に 150dpi 相当とする
    return { presetId: p.id, label: p.label, dpi: 150, w: p.w, h: p.h, trim: null, bleed: null, frame: null };
  }
  if (p.custom) {
    const tw = Number(custom.trimW) || 182, th = Number(custom.trimH) || 257;
    p = {
      ...p, label: `カスタム(${tw}×${th}mm)`, trimW: tw, trimH: th, bleed: 3, margin: 7,
      frameW: Math.max(10, tw - 30), frameH: Math.max(10, th - 36),
    };
  }
  const mm = (v) => Math.round((v * dpi) / 25.4);
  const W = mm(p.paperW ?? p.trimW + 2 * (p.bleed + p.margin));
  const H = mm(p.paperH ?? p.trimH + 2 * (p.bleed + p.margin));
  return {
    presetId: p.id,
    label: p.label,
    dpi,
    w: W,
    h: H,
    trim: centered(W, H, mm(p.trimW), mm(p.trimH)),
    bleed: centered(W, H, mm(p.trimW + 2 * p.bleed), mm(p.trimH + 2 * p.bleed)),
    frame: centered(W, H, mm(p.frameW), mm(p.frameH)),
  };
}

export const mmToPx = (paper, mm) => (mm * paper.dpi) / 25.4;
export const pxToMm = (paper, px) => (px * 25.4) / paper.dpi;
export const ptToPx = (paper, pt) => (pt * paper.dpi) / 72;
export const pxToPt = (paper, px) => (px * 72) / paper.dpi;
