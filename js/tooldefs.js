// ツール・サブツールの定義と、ツールプロパティ(設定項目)の定義
//
// ツール   : 左端のツールバーに並ぶもの(ペン・消しゴム…)
// サブツール: ツールの中の種類(Gペン・丸ペン…)。kind が実際の動作を決める。
// settings : サブツールごとの初期設定。ユーザーが変えた値は localStorage に保存される。

export const PROPS = {
  size: { label: 'ブラシサイズ', type: 'range', min: 0.5, max: 600, log: true, unit: 'px' },
  opacity: { label: '不透明度', type: 'range', min: 0.01, max: 1, step: 0.01, pct: true },
  pressure: { label: '筆圧でサイズを変える', type: 'check' },
  minSize: { label: '筆圧の最小サイズ', type: 'range', min: 0, max: 1, step: 0.01, pct: true },
  flow: { label: 'ブラシ濃度', type: 'range', min: 0.01, max: 1, step: 0.01, pct: true },
  taperIn: { label: '入り', type: 'range', min: 0, max: 1, step: 0.01, pct: true },
  taperOut: { label: '抜き', type: 'range', min: 0, max: 1, step: 0.01, pct: true },
  stabilize: { label: '手ブレ補正', type: 'range', min: 0, max: 20, step: 1 },
  snap: { label: '角度を水平・垂直・45°に吸着', type: 'check' },
  src: { label: '取得先', type: 'select', options: [['all', '表示色'], ['layer', '編集中のレイヤー']] },
};

const BRUSH_PROPS = ['size', 'opacity', 'pressure', 'minSize', 'taperIn', 'taperOut', 'stabilize'];
const brush = (o) => ({
  size: 6, opacity: 1, pressure: true, minSize: 0.15, taperIn: 0, taperOut: 0,
  stabilize: 3, soft: false, flow: 0.2, grain: false, erase: false, ...o,
});

export const TOOLS = [
  {
    id: 'hand', label: '手のひら', icon: 'hand', key: 'h',
    subtools: [{ id: 'hand', name: '手のひら', kind: 'hand', props: [], settings: {} }],
  },
  {
    id: 'eyedropper', label: 'スポイト', icon: 'eyedropper', key: 'i',
    subtools: [
      { id: 'all', name: '表示色を取得', kind: 'eyedropper', props: ['src'], settings: { src: 'all' } },
      { id: 'layer', name: 'レイヤーから取得', kind: 'eyedropper', props: ['src'], settings: { src: 'layer' } },
    ],
  },
  {
    id: 'pen', label: 'ペン', icon: 'pen', key: 'p',
    subtools: [
      { id: 'gpen', name: 'Gペン', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 7, minSize: 0.1, taperIn: 0.15, taperOut: 0.15 }) },
      { id: 'maru', name: '丸ペン', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 3.5, minSize: 0.2, taperIn: 0.1, taperOut: 0.1 }) },
      { id: 'kabura', name: 'カブラペン', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 9, minSize: 0.35 }) },
      { id: 'mili', name: 'ミリペン', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 4, pressure: false, stabilize: 2 }) },
    ],
  },
  {
    id: 'pencil', label: '鉛筆', icon: 'pencil', key: 'n',
    subtools: [
      { id: 'pencil', name: '鉛筆', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 6, minSize: 0.4, opacity: 0.85, grain: true, stabilize: 1 }) },
      { id: 'sharp', name: 'シャープペンシル', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 3, minSize: 0.5, opacity: 0.9, grain: true, stabilize: 1 }) },
      { id: 'rough', name: 'ラフ鉛筆', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 14, minSize: 0.3, opacity: 0.55, grain: true, stabilize: 0 }) },
    ],
  },
  {
    id: 'brush', label: '筆・エアブラシ', icon: 'brush', key: 'b',
    subtools: [
      { id: 'fude', name: '筆(濃い水彩)', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 30, minSize: 0.03, taperIn: 0.3, taperOut: 0.4, stabilize: 4 }) },
      { id: 'beta', name: 'ベタ塗り用', kind: 'brush', props: BRUSH_PROPS, settings: brush({ size: 40, pressure: false, stabilize: 0 }) },
      { id: 'air', name: 'エアブラシ', kind: 'brush', props: ['size', 'opacity', 'flow', 'pressure', 'minSize'], settings: brush({ size: 120, soft: true, opacity: 0.6, flow: 0.12, minSize: 0.6, stabilize: 0 }) },
    ],
  },
  {
    id: 'eraser', label: '消しゴム', icon: 'eraser', key: 'e',
    subtools: [
      { id: 'hard', name: '硬め', kind: 'brush', props: ['size', 'opacity', 'pressure', 'minSize', 'stabilize'], settings: brush({ size: 24, pressure: false, erase: true, stabilize: 0 }) },
      { id: 'fine', name: '細部用', kind: 'brush', props: ['size', 'opacity', 'pressure', 'minSize', 'stabilize'], settings: brush({ size: 6, pressure: true, minSize: 0.4, erase: true, stabilize: 0 }) },
      { id: 'soft', name: 'やわらかめ', kind: 'brush', props: ['size', 'opacity', 'flow'], settings: brush({ size: 100, soft: true, flow: 0.2, erase: true, stabilize: 0, pressure: false }) },
    ],
  },
  {
    id: 'panel', label: 'コマ枠', icon: 'panel', key: 'k',
    subtools: [
      { id: 'split', name: 'コマ枠カット(分割)', kind: 'panel', props: ['snap'], settings: { mode: 'split', snap: true } },
      { id: 'rect', name: '長方形コマ', kind: 'panel', props: [], settings: { mode: 'rect' } },
      { id: 'edit', name: 'コマ枠の編集', kind: 'panel', props: [], settings: { mode: 'edit' } },
    ],
  },
];

export const findTool = (id) => TOOLS.find((t) => t.id === id);
