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
  font: {
    label: 'フォント', type: 'select', string: true,
    options: [['antique', 'アンチック(漫画のセリフ)'], ['mincho', '明朝(ナレーション)'], ['gothic', 'ゴシック'], ['heavy', '極太ゴシック(叫び・効果音)'], ['maru', '丸ゴシック'], ['hand', '手書き風']],
  },
  sizePt: { label: '文字サイズ', type: 'range', min: 4, max: 72, step: 0.5, unit: 'pt' },
  vertical: { label: '縦書き', type: 'check' },
  bold: { label: '太字', type: 'check' },
  lineHeight: { label: '行間', type: 'range', min: 1, max: 2.5, step: 0.05, fmt: (v) => (+v).toFixed(2) },
  outline: { label: '白フチ', type: 'range', min: 0, max: 30, step: 1, unit: 'px' },
  strokeMm: { label: '線の太さ', type: 'range', min: 0, max: 2, step: 0.05, fmt: (v) => `${(+v).toFixed(2)}mm` },
  tolerance: { label: '色の誤差', type: 'range', min: 0, max: 100, step: 1 },
  expand: { label: '領域拡縮(隙間を埋める)', type: 'range', min: 0, max: 5, step: 1, unit: 'px' },
  paint: { label: '塗り方', type: 'segment', options: [['color', '色'], ['tone', 'トーン(網点)']], rebuild: true },
  lpi: { label: '線数', type: 'range', min: 20, max: 120, step: 1, unit: '線', when: (s) => s.paint === 'tone' },
  density: { label: '濃度', type: 'range', min: 0.03, max: 0.8, step: 0.01, pct: true, when: (s) => s.paint === 'tone' },
  angle: { label: '角度', type: 'range', min: 0, max: 90, step: 1, unit: '°', when: (s) => s.paint === 'tone' },
  fillMode: { label: '描き方', type: 'segment', options: [['stroke', '線'], ['fill', '塗り']] },
  count: { label: '本数', type: 'range', min: 10, max: 600, step: 1, unit: '本' },
  lineW: { label: '線の太さ', type: 'range', min: 1, max: 60, step: 0.5, unit: 'px' },
  jitter: { label: 'ばらつき', type: 'range', min: 0, max: 1, step: 0.01, pct: true },
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
    id: 'select', label: '選択範囲', icon: 'select', key: 'm',
    subtools: [
      { id: 'rect', name: '長方形選択', kind: 'select', props: [], settings: { shape: 'rect' } },
      { id: 'lasso', name: '投げ縄選択', kind: 'select', props: [], settings: { shape: 'lasso' } },
    ],
  },
  {
    id: 'object', label: '操作(テキスト・フキダシ)', icon: 'object', key: 'o',
    subtools: [{ id: 'object', name: 'オブジェクト', kind: 'object', props: [], settings: {} }],
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
    id: 'fill', label: '塗りつぶし・トーン', icon: 'fill', key: 'g',
    subtools: [
      { id: 'ref', name: '他レイヤーを参照', kind: 'fill', props: ['tolerance', 'expand', 'paint', 'lpi', 'density', 'angle'], settings: { ref: 'all', tolerance: 12, expand: 1, paint: 'color', lpi: 60, density: 0.2, angle: 45 } },
      { id: 'layer', name: '編集レイヤーのみ参照', kind: 'fill', props: ['tolerance', 'expand', 'paint', 'lpi', 'density', 'angle'], settings: { ref: 'layer', tolerance: 12, expand: 1, paint: 'color', lpi: 60, density: 0.2, angle: 45 } },
      { id: 'lasso', name: '囲って塗る', kind: 'lassofill', props: ['paint', 'lpi', 'density', 'angle'], settings: { paint: 'color', lpi: 60, density: 0.2, angle: 45 } },
      { id: 'tone', name: 'トーン(網点)を貼る', kind: 'fill', props: ['tolerance', 'expand', 'lpi', 'density', 'angle'], settings: { ref: 'all', tolerance: 12, expand: 1, paint: 'tone', lpi: 60, density: 0.2, angle: 45 } },
    ],
  },
  {
    id: 'shape', label: '図形・効果線', icon: 'shape', key: 'u',
    subtools: [
      { id: 'line', name: '直線', kind: 'shape', props: ['size', 'snap'], settings: { form: 'line', size: 4, snap: true } },
      { id: 'rect', name: '長方形', kind: 'shape', props: ['size', 'fillMode'], settings: { form: 'rect', size: 4, fillMode: 'stroke' } },
      { id: 'ellipse', name: '楕円', kind: 'shape', props: ['size', 'fillMode'], settings: { form: 'ellipse', size: 4, fillMode: 'stroke' } },
      { id: 'focus', name: '集中線', kind: 'shape', props: ['count', 'lineW', 'jitter'], settings: { form: 'focus', count: 160, lineW: 6, jitter: 0.5 } },
      { id: 'speed', name: '流線', kind: 'shape', props: ['count', 'lineW', 'jitter'], settings: { form: 'speed', count: 90, lineW: 5, jitter: 0.6 } },
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
  {
    id: 'text', label: 'テキスト', icon: 'text', key: 't',
    subtools: [{
      id: 'text', name: 'テキスト', kind: 'text', props: ['font', 'sizePt', 'vertical', 'bold', 'lineHeight', 'outline'],
      settings: { font: 'antique', sizePt: 9, vertical: true, bold: false, lineHeight: 1.5, outline: 0 },
    }],
  },
  {
    id: 'balloon', label: 'フキダシ', icon: 'balloon', key: 'f',
    subtools: [
      { id: 'ellipse', name: '楕円フキダシ', kind: 'balloon', props: ['strokeMm'], settings: { shape: 'ellipse', strokeMm: 0.35 } },
      { id: 'round', name: '角丸フキダシ', kind: 'balloon', props: ['strokeMm'], settings: { shape: 'round', strokeMm: 0.35 } },
      { id: 'rect', name: 'ナレーション(長方形)', kind: 'balloon', props: ['strokeMm'], settings: { shape: 'rect', strokeMm: 0.3 } },
      { id: 'cloud', name: '思考フキダシ(雲)', kind: 'balloon', props: ['strokeMm'], settings: { shape: 'cloud', strokeMm: 0.3 } },
      { id: 'spike', name: '叫びフキダシ(トゲ)', kind: 'balloon', props: ['strokeMm'], settings: { shape: 'spike', strokeMm: 0.4 } },
      { id: 'tail', name: 'しっぽを付ける', kind: 'balloon', props: [], settings: { mode: 'tail' } },
    ],
  },
];

export const findTool = (id) => TOOLS.find((t) => t.id === id);
