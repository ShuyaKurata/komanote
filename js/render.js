// ページの描画(画面表示・サムネイル・書き出しで共通)
// ctx はあらかじめ「ページ座標 → 出力先」の変換が設定されていること。
// 重ね順: 白い用紙 → ラスターレイヤー(下から) → コマ外のマスクとコマ枠 → テキスト・フキダシ → ガイド

import { drawPanels } from './panels.js';
import { drawItems } from './text.js';

/**
 * @param opts.guides       ガイド(裁ち落とし・仕上がり・基本枠)を描くか
 * @param opts.includeDraft 下書きレイヤーを含めるか(書き出しでは false)
 * @param opts.px           画面上の 1px がページ座標でいくつか(ガイド線の太さ用)
 * @param opts.afterLayer   (ctx, layer) 各レイヤーを描いた直後に呼ばれる(変形中のプレビュー用)
 * @param opts.paper        白い用紙を塗るか
 * @param opts.layerRange   [開始, 終了) 描くレイヤーの範囲(描画中の高速表示で、編集中レイヤーの上下を分けて描くため)
 * @param opts.decorations  コマ枠・テキストを描くか
 * @param opts.itemCache    テキスト・フキダシを画像キャッシュで描くか(画面表示用)
 */
export function renderPage(ctx, project, page, opts = {}) {
  const { w, h } = project.paper;
  const {
    guides = false, includeDraft = true, px = 1, afterLayer = null,
    paper = true, layerRange = null, decorations = true, itemCache = false,
  } = opts;

  ctx.save();
  if (paper) {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
  }
  const [from, to] = layerRange || [0, page.layers.length];
  for (let i = from; i < to; i++) {
    const L = page.layers[i];
    if (!L.visible || !L.canvas) continue;
    if (L.draft && !includeDraft) continue;
    ctx.globalAlpha = L.opacity;
    ctx.globalCompositeOperation = L.blend || 'source-over';
    ctx.drawImage(L.canvas, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (afterLayer) afterLayer(ctx, L);
  }
  ctx.restore();

  if (decorations) {
    drawPanels(ctx, project, page);
    drawItems(ctx, project, page, itemCache);
  }
  if (guides) drawGuides(ctx, project.paper, px);
}

export function drawGuides(ctx, paper, px) {
  ctx.save();
  ctx.lineWidth = px;
  if (paper.bleed) {
    ctx.strokeStyle = 'rgba(0,160,233,.9)';
    ctx.setLineDash([6 * px, 4 * px]);
    strokeRect(ctx, paper.bleed);
  }
  if (paper.trim) {
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(0,160,233,.9)';
    strokeRect(ctx, paper.trim);
  }
  if (paper.frame) {
    ctx.setLineDash([3 * px, 3 * px]);
    ctx.strokeStyle = 'rgba(60,90,255,.85)';
    strokeRect(ctx, paper.frame);
  }
  ctx.restore();
}

function strokeRect(ctx, r) {
  ctx.strokeRect(r.x, r.y, r.w, r.h);
}

/** ページ全体を指定サイズのキャンバスに描く */
export function renderPageTo(canvas, project, page, opts = {}) {
  const ctx = canvas.getContext('2d');
  const s = canvas.width / project.paper.w;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.imageSmoothingQuality = 'high';
  renderPage(ctx, project, page, { px: 1 / s, ...opts });
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
