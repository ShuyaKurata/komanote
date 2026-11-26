// 作品データの構造
//
// project = { id, name, version, createdAt, updatedAt, paper, pages[], currentPage }
// page    = { id, layers[](下から順), activeLayerId, panels[], items[], panelStyle, showPanels, showItems, thumb }
// layer   = { id, name, visible, opacity, blend, locked, draft, canvas(実行時のみ), dirty(実行時のみ) }
//
// レイヤーの画素は IndexedDB に PNG として別保存し、開いているページの分だけ canvas に展開する。

import { uid, deepClone } from './util.js';
import { mmToPx } from './paper.js';

export const BLEND_MODES = [
  ['source-over', '通常'],
  ['multiply', '乗算'],
  ['screen', 'スクリーン'],
  ['overlay', 'オーバーレイ'],
  ['darken', '比較(暗)'],
  ['lighten', '比較(明)'],
];

export function createLayer(name, opts = {}) {
  return {
    id: uid(), name, visible: true, opacity: 1, blend: 'source-over',
    locked: false, draft: false, canvas: null, dirty: false, ...opts,
  };
}

export function createPage(paper) {
  const draft = createLayer('下書き', { draft: true, opacity: 0.6 });
  const ink = createLayer('ペン入れ');
  return {
    id: uid(),
    layers: [draft, ink],
    activeLayerId: ink.id,
    panels: [],
    items: [],
    panelStyle: {
      border: Math.max(1, Math.round(mmToPx(paper, 0.6))),
      gapH: Math.round(mmToPx(paper, 2)), // 左右に並ぶコマの間隔
      gapV: Math.round(mmToPx(paper, 5)), // 上下に並ぶコマの間隔
    },
    maskOutside: true,
    showPanels: true,
    showItems: true,
    thumb: null,
  };
}

export function createProject({ name, paper, pageCount = 1 }) {
  const now = Date.now();
  const pages = [];
  for (let i = 0; i < pageCount; i++) pages.push(createPage(paper));
  return { id: uid(), name: name || '無題の原稿', version: 1, createdAt: now, updatedAt: now, paper, pages, currentPage: 0 };
}

/** 保存用 JSON(canvas などの実行時プロパティを除く) */
export function serializeProject(project) {
  return JSON.parse(JSON.stringify(project, (k, v) => (k === 'canvas' || k === 'dirty' ? undefined : v)));
}

/** ページを複製する。レイヤー ID の対応表も返す(画素データのコピー用) */
export function clonePage(page) {
  const copy = deepClone({ ...page, layers: page.layers.map(({ canvas, dirty, ...rest }) => rest) });
  copy.id = uid();
  const idMap = {};
  for (const L of copy.layers) {
    const nid = uid();
    idMap[L.id] = nid;
    if (copy.activeLayerId === L.id) copy.activeLayerId = nid;
    L.id = nid;
    L.canvas = null;
    L.dirty = false;
  }
  for (const p of copy.panels) p.id = uid();
  for (const it of copy.items) it.id = uid();
  return { page: copy, idMap };
}

export const blobKey = (projectId, layerId) => `${projectId}/${layerId}`;

/** 各ページのページ番号 [始め, 終わり](見開きは 2 ページ分) */
export function pageNumbers(project) {
  let n = 1;
  return project.pages.map((p) => {
    const r = p.spread ? [n, n + 1] : [n, n];
    n = r[1] + 1;
    return r;
  });
}
export const pageLabel = ([a, b]) => (a === b ? `${a}` : `${a}-${b}`);
export const totalPages = (project) => project.pages.reduce((s, p) => s + (p.spread ? 2 : 1), 0);
