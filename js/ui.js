// 画面のパレット類(メニュー・ツール・サブツール・ツールプロパティ・カラー・ナビゲーター・レイヤー・ページ管理)

import { h, debounce, clamp, hexToRgb, rgbToHex, rgbToHsv, hsvToRgb, makeCanvas } from './util.js';
import { icon } from './icons.js';
import { TOOLS, PROPS } from './tooldefs.js';
import { BLEND_MODES } from './model.js';
import { renderPageTo } from './render.js';
import { showDialog } from './dialog.js';
import { showStorageNotice } from './notice.js';

/** メニューの定義。'-' は区切り線 */
export const MENUS = [
  {
    label: 'ファイル', items: [
      { label: '作品一覧に戻る', cmd: 'home' },
      { label: '保存', cmd: 'save', key: '⌘S' },
      { label: '作品名の変更…', cmd: 'rename' },
      '-',
      { label: '画像・PDF の書き出し…', cmd: 'export', key: '⇧⌘E' },
      { label: '作品ファイル(.komanote)として保存', cmd: 'export-project' },
    ],
  },
  {
    label: '編集', items: [
      { label: '取り消し', cmd: 'undo', key: '⌘Z' },
      { label: 'やり直し', cmd: 'redo', key: '⇧⌘Z' },
      '-',
      { label: '消去', cmd: 'clear', key: 'Del' },
      { label: '拡大・縮小・回転(変形)', cmd: 'transform', key: '⌘T' },
    ],
  },
  {
    label: '選択範囲', items: [
      { label: 'すべてを選択', cmd: 'select-all', key: '⌘A' },
      { label: '選択を解除', cmd: 'deselect', key: '⌘D' },
      '-',
      { label: '選択範囲を塗りつぶし(メインカラー)', cmd: 'fill-selection' },
      { label: '選択範囲にトーンを貼る(新規レイヤー)', cmd: 'tone-selection' },
      { label: '選択範囲を消去', cmd: 'clear' },
    ],
  },
  {
    label: 'レイヤー', items: [
      { label: '新規ラスターレイヤー', cmd: 'layer-add' },
      { label: '新規下書きレイヤー', cmd: 'layer-add-draft' },
      { label: 'レイヤーを複製', cmd: 'layer-dup' },
      { label: '下のレイヤーと結合', cmd: 'layer-merge' },
      '-',
      { label: 'レイヤーを削除', cmd: 'layer-del' },
    ],
  },
  {
    label: 'ページ', items: [
      { label: 'ページを追加', cmd: 'page-add' },
      { label: 'ページを複製', cmd: 'page-dup' },
      { label: 'ページを削除', cmd: 'page-del' },
      '-',
      { label: '前のページ', cmd: 'page-prev' },
      { label: '次のページ', cmd: 'page-next' },
    ],
  },
  {
    label: '表示', items: [
      { label: '全体表示', cmd: 'fit', key: '⌘0' },
      { label: '幅に合わせる', cmd: 'fit-width' },
      { label: '100%', cmd: 'zoom-100', key: '⌘1' },
      { label: '拡大', cmd: 'zoom-in', key: '⌘+' },
      { label: '縮小', cmd: 'zoom-out', key: '⌘-' },
      '-',
      { label: '左右反転', cmd: 'flip' },
      { label: '回転をリセット', cmd: 'rotate-reset', key: 'R' },
      '-',
      { label: 'ガイドを表示', cmd: 'toggle-guides', check: (ed) => ed.prefs.showGuides },
      { label: 'ピンチで回転する', cmd: 'toggle-rotate', check: (ed) => ed.prefs.allowRotate },
      '-',
      { label: '指で描く: 自動(Pencil使用後は移動のみ)', cmd: 'finger-mode', arg: 'auto', check: (ed) => ed.prefs.fingerDraw === 'auto' },
      { label: '指で描く: 常に描く', cmd: 'finger-mode', arg: 'on', check: (ed) => ed.prefs.fingerDraw === 'on' },
      { label: '指で描く: 描かない(移動のみ)', cmd: 'finger-mode', arg: 'off', check: (ed) => ed.prefs.fingerDraw === 'off' },
      '-',
      { label: 'パレットの表示切替', cmd: 'toggle-palettes', key: 'Tab' },
    ],
  },
  { label: 'ヘルプ', items: [{ label: '操作方法', cmd: 'help' }, { label: 'データの保存について(大切)', cmd: 'storage-notice' }] },
];

const SWATCHES = ['#000000', '#404040', '#808080', '#b3b3b3', '#ffffff', '#3b6fd8', '#d83b3b', '#f0c419', '#2fa84f', '#8e44ad'];

export class UI {
  constructor(ed) {
    this.ed = ed;
    this.root = ed.root;
    this.$ = (s) => this.root.querySelector(s);
    this.hsv = [0, 0, 0];
    this.buildMenus();
    this.buildQuick();
    this.buildToolbar();
    this.buildColor();
    this.buildNav();
    this.buildLayers();
    this.buildPages();
    this.scheduleThumbs = debounce(() => {
      if (this.ed.active) { this.scheduleThumbs(); return; } // 描いている間は更新しない
      this.refreshLayerThumbs();
      this.drawNavThumb();
      this.refreshCurrentPageThumb();
    }, 700);
    if (this.isNarrow()) this.root.classList.add('hide-right', 'hide-left');
  }

  refreshAll() {
    this.refreshTitle();
    this.refreshTools();
    this.refreshColor();
    this.refreshLayers();
    this.refreshPages();
    this.refreshUndo();
    this.refreshMenus();
    this.refreshFingerMode();
    this.refreshFloat();
    this.drawNavThumb();
    this.refreshNav();
    this.setStatus('保存済み');
  }

  // ---------------- メニュー ----------------
  buildMenus() {
    const bar = this.$('#menus');
    bar.innerHTML = '';
    for (const m of MENUS) {
      const btn = h('button', { class: 'menu-btn' }, m.label);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const open = this.openMenu === m;
        this.closeMenu();
        if (!open) this.showMenu(m, btn);
      });
      bar.append(btn);
    }
    document.addEventListener('pointerdown', (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target) && !e.target.closest('.menu-btn')) this.closeMenu();
    });
  }

  showMenu(m, btn) {
    const r = btn.getBoundingClientRect();
    const el = h('div', { class: 'menu-pop', style: { left: `${r.left}px`, top: `${r.bottom + 2}px` } },
      m.items.map((it) => {
        if (it === '-') return h('div', { class: 'menu-sep' });
        const checked = it.check ? it.check(this.ed) : null;
        return h('button', {
          class: 'menu-item',
          onclick: () => { this.closeMenu(); this.ed.command(it.cmd, it.arg); },
        },
        h('span', { class: 'menu-check' }, checked ? '✓' : ''),
        h('span', { class: 'menu-label' }, it.label),
        h('span', { class: 'menu-key' }, it.key || ''));
      }));
    document.body.append(el);
    const er = el.getBoundingClientRect();
    if (er.right > window.innerWidth - 4) el.style.left = `${window.innerWidth - er.width - 4}px`;
    this.menuEl = el;
    this.openMenu = m;
  }

  closeMenu() {
    this.menuEl?.remove();
    this.menuEl = null;
    this.openMenu = null;
  }

  refreshMenus() { /* チェック表示はメニューを開くたびに作り直すので不要 */ }

  // ---------------- コマンドバー ----------------
  buildQuick() {
    const q = this.$('#quick');
    const b = (ic, title, cmd, cls = '') => h('button', { class: 'qbtn ' + cls, title, html: icon(ic), onclick: () => this.ed.command(cmd) });
    this.undoBtn = b('undo', '取り消し (⌘Z / 2本指タップ)', 'undo');
    this.redoBtn = b('redo', 'やり直し (⇧⌘Z / 3本指タップ)', 'redo');
    this.fingerChip = h('button', { class: 'chip', title: '指で描くかどうか', onclick: () => this.cycleFinger() });
    q.append(
      b('home', '作品一覧', 'home'),
      b('save', '保存 (⌘S)', 'save'),
      h('button', { class: 'qbtn wide', title: '画像・PDF の書き出し', onclick: () => this.ed.command('export') }, '書き出し'),
      h('span', { class: 'qsep' }),
      this.undoBtn, this.redoBtn,
      h('span', { class: 'qsep' }),
      b('fit', '全体表示 (⌘0)', 'fit'),
      b('flip', '左右反転', 'flip'),
      b('rotate', '回転をリセット (R)', 'rotate-reset'),
      h('span', { class: 'qsep' }),
      this.fingerChip,
      h('span', { class: 'qsep' }),
      b('panels', 'パレット表示切替 (Tab)', 'toggle-palettes'),
      b('pages', 'ページ管理の表示切替', 'toggle-pages'),
    );
  }

  cycleFinger() {
    const order = ['auto', 'on', 'off'];
    const next = order[(order.indexOf(this.ed.prefs.fingerDraw) + 1) % 3];
    this.ed.command('finger-mode', next);
  }

  refreshFingerMode() {
    const m = this.ed.prefs.fingerDraw;
    const draws = this.ed.fingerDraws();
    this.fingerChip.textContent = m === 'auto' ? `指: 自動(${draws ? '描く' : '移動'})` : m === 'on' ? '指: 描く' : '指: 移動のみ';
  }

  refreshUndo() {
    if (!this.undoBtn) return;
    this.undoBtn.disabled = !this.ed.history.canUndo;
    this.redoBtn.disabled = !this.ed.history.canRedo;
  }

  refreshTitle() {
    const p = this.ed.project;
    this.$('#doc-title').textContent = `${p.name} — ${this.ed.pageIndex + 1}/${p.pages.length}ページ`;
  }

  setStatus(s) {
    const el = this.$('#status');
    el.textContent = s;
    el.dataset.state = s;
  }

  togglePalettes() {
    const hidden = this.root.classList.contains('hide-left') && this.root.classList.contains('hide-right');
    this.root.classList.toggle('hide-left', !hidden);
    this.root.classList.toggle('hide-right', !hidden);
    this.afterLayoutChange();
  }

  isNarrow() { return window.innerWidth < 1000; }

  /** 狭い画面でキャンバスに重なっているパレットを閉じる。閉じたら true */
  closeOverlayDocks() {
    if (!this.isNarrow()) return false;
    const open = !this.root.classList.contains('hide-left') || !this.root.classList.contains('hide-right');
    if (open) {
      this.root.classList.add('hide-left', 'hide-right');
      this.afterLayoutChange();
    }
    return open;
  }

  toggleDock(name) {
    this.root.classList.toggle('hide-' + name);
    this.afterLayoutChange();
  }

  afterLayoutChange() {
    requestAnimationFrame(() => { this.ed.resize(); this.refreshNav(); });
  }

  // ---------------- ツール ----------------
  buildToolbar() {
    const bar = this.$('#toolbar');
    bar.innerHTML = '';
    this.toolBtns = {};
    for (const t of TOOLS) {
      const btn = h('button', {
        class: 'tool-btn', title: `${t.label}${t.key ? ` (${t.key.toUpperCase()})` : ''}`,
        html: icon(t.icon, 22),
        onclick: () => {
          // 選択中のツールをもう一度押すと、サブツール・ツールプロパティのパレットを開閉する
          if (this.ed.toolId === t.id) this.toggleDock('left');
          else this.ed.setTool(t.id);
        },
      });
      this.toolBtns[t.id] = btn;
      bar.append(btn);
    }
  }

  refreshTools() {
    for (const [id, b] of Object.entries(this.toolBtns)) b.classList.toggle('active', id === this.ed.toolId);
    const t = this.ed.toolDef(), cur = this.ed.subtoolDef();
    this.$('#subtool-title').textContent = `サブツール[${t.label}]`;
    const list = this.$('#subtools');
    list.innerHTML = '';
    for (const s of t.subtools) {
      list.append(h('button', {
        class: 'subtool' + (s === cur ? ' active' : ''),
        onclick: () => this.ed.setSubtool(s.id),
      }, h('span', { class: 'sub-ic', html: icon(t.icon, 16) }), s.name));
    }
    this.refreshToolProps();
  }

  refreshToolProps() {
    const box = this.$('#toolprops');
    box.innerHTML = '';
    const sub = this.ed.subtoolDef();
    const tool = this.ed.tool;
    this.$('#toolprop-title').textContent = `ツールプロパティ[${tool?.title || sub.name}]`;
    if (tool?.buildProps) tool.buildProps(box, this);
    if (tool?.title) return; // 変形などの一時ツールは固有の設定だけを出す
    const s = this.ed.settings();
    for (const key of sub.props || []) {
      const def = PROPS[key];
      if (!def || (def.when && !def.when(s))) continue;
      box.append(this.control(def, s[key], (v) => {
        s[key] = v;
        this.ed.saveToolPrefs();
        tool?.settingsChanged?.(key, v);
        if (def.rebuild) this.refreshToolProps();
        this.ed.requestRender();
      }));
    }
    if ((sub.props || []).length) {
      box.append(h('button', { class: 'btn small ghost reset', onclick: () => this.ed.resetSubtool() }, '初期設定に戻す'));
    }
  }

  /** 設定項目 1 つ分の入力欄を作る */
  control(def, value, onChange) {
    if (def.type === 'check') {
      const input = h('input', { type: 'checkbox', checked: !!value, onchange: () => onChange(input.checked) });
      return h('label', { class: 'prop check' }, input, h('span', {}, def.label));
    }
    if (def.type === 'select') {
      const sel = h('select', { class: 'select', onchange: () => onChange(isNaN(+sel.value) || def.string ? sel.value : +sel.value) },
        def.options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
      return h('label', { class: 'prop' }, h('span', { class: 'prop-label' }, def.label), sel);
    }
    if (def.type === 'segment') {
      const wrap = h('div', { class: 'segment' });
      for (const [v, l] of def.options) {
        wrap.append(h('button', {
          class: 'seg' + (v === value ? ' active' : ''),
          onclick: () => { onChange(v); wrap.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.textContent === l)); },
        }, l));
      }
      return h('div', { class: 'prop' }, h('span', { class: 'prop-label' }, def.label), wrap);
    }
    if (def.type === 'text') {
      const input = h('input', { type: 'text', class: 'input', value: value ?? '', onchange: () => onChange(input.value) });
      return h('label', { class: 'prop' }, h('span', { class: 'prop-label' }, def.label), input);
    }
    if (def.type === 'color') {
      const input = h('input', { type: 'color', value, oninput: () => onChange(input.value) });
      return h('label', { class: 'prop inline' }, h('span', { class: 'prop-label' }, def.label), input);
    }
    // range
    const { min, max, log } = def;
    const step = def.step ?? (log ? 0.001 : 1);
    const toSlider = (v) => (log ? (Math.log(v / min) / Math.log(max / min)) * 1000 : v);
    const fromSlider = (t) => (log ? min * Math.pow(max / min, t / 1000) : t);
    const fmt = (v) => def.fmt ? def.fmt(v, this.ed) : def.pct ? `${Math.round(v * 100)}%` : `${v < 10 && step < 1 ? (+v).toFixed(1) : Math.round(v)}${def.unit || ''}`;
    const val = h('span', { class: 'prop-val' }, fmt(value));
    const input = h('input', {
      type: 'range', class: 'range', min: log ? 0 : min, max: log ? 1000 : max, step: log ? 1 : step, value: toSlider(value),
    });
    input.addEventListener('input', () => {
      let v = fromSlider(+input.value);
      if (log) v = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
      val.textContent = fmt(v);
      onChange(v);
    });
    return h('div', { class: 'prop' }, h('div', { class: 'prop-head' }, h('span', { class: 'prop-label' }, def.label), val), input);
  }

  /** キャンバス上部のフローティングバー(変形の確定/選択範囲の操作) */
  refreshFloat() {
    const box = this.$('#float-ui');
    box.innerHTML = '';
    const ed = this.ed;
    if (!ed.project) return;
    let items = ed.tool?.floatBar?.();
    if (!items && ed.selection) {
      items = [
        ['選択解除', () => ed.command('deselect')],
        ['消去', () => ed.command('clear')],
        ['塗りつぶし', () => ed.command('fill-selection')],
        ['トーン', () => ed.command('tone-selection')],
        ['変形', () => ed.command('transform'), true],
      ];
    }
    if (!items) return;
    box.append(h('div', { class: 'float-bar' }, items.map(([label, fn, primary]) => h('button', { class: 'btn small' + (primary ? ' primary' : ''), onclick: fn }, label))));
  }

  // ---------------- カラー ----------------
  buildColor() {
    const box = this.$('#color');
    this.slotMain = h('button', { class: 'slot main', title: 'メインカラー', onclick: () => this.ed.selectColorSlot('main') });
    this.slotSub = h('button', { class: 'slot sub', title: 'サブカラー', onclick: () => this.ed.selectColorSlot('sub') });
    this.slotTrans = h('button', { class: 'slot transparent', title: '透明色(描くと消える) (C)', onclick: () => this.ed.setTransparent(!this.ed.color.transparent) });
    this.hexLabel = h('span', { class: 'hex' });
    this.sv = h('canvas', { class: 'sv' });
    this.svMarker = h('div', { class: 'sv-marker' });
    this.hue = h('canvas', { class: 'hue' });
    this.hueMarker = h('div', { class: 'hue-marker' });
    this.recent = h('div', { class: 'swatches recent' });
    box.append(
      h('div', { class: 'color-top' },
        h('div', { class: 'slots' }, this.slotMain, this.slotSub),
        h('button', { class: 'icon-btn', title: 'メインとサブを入れ替え (X)', onclick: () => this.ed.swapColors() }, '⇄'),
        this.slotTrans, this.hexLabel),
      h('div', { class: 'sv-wrap' }, this.sv, this.svMarker),
      h('div', { class: 'hue-wrap' }, this.hue, this.hueMarker),
      h('div', { class: 'swatches' }, SWATCHES.map((c) => h('button', { class: 'sw', style: { background: c }, title: c, onclick: () => this.ed.setColor(c) }))),
      this.recent,
    );
    const drag = (el, fn) => {
      el.addEventListener('pointerdown', (e) => {
        el.setPointerCapture(e.pointerId);
        fn(e, false);
        const mv = (ev) => fn(ev, false);
        const up = (ev) => { fn(ev, true); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv);
        el.addEventListener('pointerup', up);
      });
    };
    drag(this.sv, (e, done) => {
      const r = this.sv.getBoundingClientRect();
      this.hsv[1] = clamp((e.clientX - r.left) / r.width, 0, 1);
      this.hsv[2] = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);
      this.applyHsv(done);
    });
    drag(this.hue, (e, done) => {
      const r = this.hue.getBoundingClientRect();
      this.hsv[0] = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 360;
      this.applyHsv(done);
    });
  }

  applyHsv(record) {
    this.fromPicker = true;
    this.ed.setColor(rgbToHex(...hsvToRgb(...this.hsv)), { record });
    this.fromPicker = false;
  }

  refreshColor() {
    const c = this.ed.color;
    this.slotMain.style.background = c.main;
    this.slotSub.style.background = c.sub;
    this.slotMain.classList.toggle('active', c.which === 'main' && !c.transparent);
    this.slotSub.classList.toggle('active', c.which === 'sub' && !c.transparent);
    this.slotTrans.classList.toggle('active', c.transparent);
    const hex = this.ed.currentColor();
    this.hexLabel.textContent = c.transparent ? '透明' : hex;
    if (!this.fromPicker) {
      const [hh, s, v] = rgbToHsv(...hexToRgb(hex));
      this.hsv = [s === 0 || v === 0 ? this.hsv[0] : hh, s, v];
    }
    this.drawPicker();
    this.recent.innerHTML = '';
    for (const col of this.ed.recentColors) {
      this.recent.append(h('button', { class: 'sw', style: { background: col }, title: col, onclick: () => this.ed.setColor(col) }));
    }
  }

  drawPicker() {
    const sv = this.sv, w = sv.clientWidth || 200, ht = sv.clientHeight || 120;
    if (sv.width !== w || sv.height !== ht) { sv.width = w; sv.height = ht; }
    const ctx = sv.getContext('2d');
    ctx.fillStyle = rgbToHex(...hsvToRgb(this.hsv[0], 1, 1));
    ctx.fillRect(0, 0, w, ht);
    let g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, ht);
    g = ctx.createLinearGradient(0, 0, 0, ht);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, ht);
    this.svMarker.style.left = `${this.hsv[1] * 100}%`;
    this.svMarker.style.top = `${(1 - this.hsv[2]) * 100}%`;

    const hu = this.hue, hw = hu.clientWidth || 200, hh = hu.clientHeight || 14;
    if (hu.width !== hw || hu.height !== hh) { hu.width = hw; hu.height = hh; }
    const hc = hu.getContext('2d');
    const hg = hc.createLinearGradient(0, 0, hw, 0);
    for (let i = 0; i <= 6; i++) hg.addColorStop(i / 6, rgbToHex(...hsvToRgb((i * 60) % 360, 1, 1)));
    hc.fillStyle = hg; hc.fillRect(0, 0, hw, hh);
    this.hueMarker.style.left = `${(this.hsv[0] / 360) * 100}%`;
  }

  // ---------------- ナビゲーター ----------------
  buildNav() {
    const box = this.$('#nav');
    this.navThumb = h('canvas', { class: 'nav-thumb' });
    this.navOver = h('canvas', { class: 'nav-over' });
    this.navZoom = h('input', { type: 'range', class: 'range', min: 0, max: 1000 });
    this.navZoomVal = h('span', { class: 'prop-val' });
    this.navRot = h('input', { type: 'range', class: 'range', min: -180, max: 180, step: 1 });
    this.navRotVal = h('span', { class: 'prop-val' });
    const view = h('div', { class: 'nav-view' }, this.navThumb, this.navOver);
    const btn = (ic, title, cmd) => h('button', { class: 'icon-btn', title, html: icon(ic, 18), onclick: () => this.ed.command(cmd) });
    box.append(
      view,
      h('div', { class: 'prop' }, h('div', { class: 'prop-head' }, h('span', { class: 'prop-label' }, '拡大率'), this.navZoomVal), this.navZoom),
      h('div', { class: 'prop' }, h('div', { class: 'prop-head' }, h('span', { class: 'prop-label' }, '回転'), this.navRotVal), this.navRot),
      h('div', { class: 'btn-row' },
        btn('fit', '全体表示', 'fit'), h('button', { class: 'icon-btn text', title: '100%', onclick: () => this.ed.command('zoom-100') }, '100%'),
        btn('flip', '左右反転', 'flip'), btn('rotate', '回転リセット', 'rotate-reset')),
    );
    const zmin = 0.02, zmax = 32;
    this.navZoom.addEventListener('input', () => {
      const s = zmin * Math.pow(zmax / zmin, this.navZoom.value / 1000);
      this.ed.zoomAt(this.ed.center(), s);
    });
    this.navRot.addEventListener('input', () => this.ed.rotateTo(+this.navRot.value));
    const jump = (e) => {
      const r = this.navOver.getBoundingClientRect();
      const { w, h: ph } = this.ed.project.paper;
      const k = this.navGeom;
      if (!k) return;
      const x = ((e.clientX - r.left) * (this.navOver.width / r.width) - k.ox) / k.s;
      const y = ((e.clientY - r.top) * (this.navOver.height / r.height) - k.oy) / k.s;
      this.ed.anchorView({ x: clamp(x, 0, w), y: clamp(y, 0, ph) }, this.ed.center());
    };
    this.navOver.addEventListener('pointerdown', (e) => {
      this.navOver.setPointerCapture(e.pointerId);
      jump(e);
      const mv = (ev) => jump(ev);
      const up = () => { this.navOver.removeEventListener('pointermove', mv); this.navOver.removeEventListener('pointerup', up); };
      this.navOver.addEventListener('pointermove', mv);
      this.navOver.addEventListener('pointerup', up);
    });
    this.zrange = [zmin, zmax];
  }

  navLayout() {
    const view = this.navThumb.parentElement;
    const W = view.clientWidth || 220, H = view.clientHeight || 150;
    const { w, h: ph } = this.ed.project.paper;
    const s = Math.min((W - 8) / w, (H - 8) / ph);
    return { W, H, s, ox: (W - w * s) / 2, oy: (H - ph * s) / 2 };
  }

  drawNavThumb() {
    if (!this.ed.project || this.root.classList.contains('hide-right')) return;
    const g = (this.navGeom = this.navLayout());
    for (const c of [this.navThumb, this.navOver]) { c.width = g.W; c.height = g.H; }
    const tmp = makeCanvas(Math.max(1, this.ed.project.paper.w * g.s), Math.max(1, this.ed.project.paper.h * g.s));
    renderPageTo(tmp, this.ed.project, this.ed.page, {});
    const ctx = this.navThumb.getContext('2d');
    ctx.clearRect(0, 0, g.W, g.H);
    ctx.drawImage(tmp, g.ox, g.oy);
    tmp.width = 0;
    this.refreshNav();
  }

  refreshNav() {
    const ed = this.ed;
    if (!ed.project) return;
    const [zmin, zmax] = this.zrange;
    this.navZoom.value = (Math.log(ed.view.scale / zmin) / Math.log(zmax / zmin)) * 1000;
    this.navZoomVal.textContent = `${Math.round(ed.view.scale * ed.dpr * 100)}%`;
    this.navRot.value = Math.round(ed.view.rot);
    this.navRotVal.textContent = `${Math.round(ed.view.rot)}°`;
    const g = this.navGeom;
    if (!g || this.root.classList.contains('hide-right')) return;
    const ctx = this.navOver.getContext('2d');
    ctx.clearRect(0, 0, g.W, g.H);
    const { w, h: hh } = ed.viewSize();
    const corners = [[0, 0], [w, 0], [w, hh], [0, hh]].map(([x, y]) => ed.toPage(x, y));
    ctx.beginPath();
    corners.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo'](g.ox + p.x * g.s, g.oy + p.y * g.s));
    ctx.closePath();
    ctx.strokeStyle = '#ff4d4d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---------------- レイヤー ----------------
  buildLayers() {
    const box = this.$('#layers');
    this.blendSel = h('select', { class: 'select', onchange: () => this.ed.updateLayer(this.ed.layer, { blend: this.blendSel.value }) },
      BLEND_MODES.map(([v, l]) => h('option', { value: v }, l)));
    this.opacity = h('input', { type: 'range', class: 'range', min: 0, max: 100 });
    this.opacityVal = h('span', { class: 'prop-val' });
    this.opacity.addEventListener('input', () => {
      this.opacityVal.textContent = `${this.opacity.value}%`;
      this.ed.layer.opacity = this.opacity.value / 100;
      this.ed.requestRender();
    });
    this.opacity.addEventListener('change', () => this.ed.updateLayer(this.ed.layer, { opacity: this.opacity.value / 100 }));
    this.draftChk = h('input', { type: 'checkbox', onchange: () => this.ed.updateLayer(this.ed.layer, { draft: this.draftChk.checked }) });
    this.layerList = h('div', { class: 'layer-list' });
    const b = (ic, title, cmd) => h('button', { class: 'icon-btn', title, html: icon(ic, 18), onclick: () => this.ed.command(cmd) });
    box.append(
      h('div', { class: 'layer-props' },
        h('div', { class: 'row' }, this.blendSel, h('label', { class: 'check mini', title: '書き出し時に含めない' }, this.draftChk, '下書き')),
        h('div', { class: 'prop' }, h('div', { class: 'prop-head' }, h('span', { class: 'prop-label' }, '不透明度'), this.opacityVal), this.opacity)),
      h('div', { class: 'btn-row' },
        b('plus', '新規ラスターレイヤー', 'layer-add'), b('draft', '新規下書きレイヤー', 'layer-add-draft'),
        b('copy', 'レイヤーを複製', 'layer-dup'), b('merge', '下のレイヤーと結合', 'layer-merge'),
        b('up', '上へ', 'layer-up'), b('down', '下へ', 'layer-down'), b('trash', 'レイヤーを削除', 'layer-del')),
      this.layerList,
    );
  }

  refreshLayers() {
    const ed = this.ed;
    if (!ed.project) return;
    const page = ed.page, active = ed.layer;
    this.blendSel.value = active.blend;
    this.opacity.value = Math.round(active.opacity * 100);
    this.opacityVal.textContent = `${this.opacity.value}%`;
    this.draftChk.checked = !!active.draft;
    this.layerList.innerHTML = '';
    for (const t of new Set(Object.values(ed.toolImpls))) if (t.layerRow) this.layerList.append(t.layerRow());
    this.layerThumbs = [];
    for (const L of [...page.layers].reverse()) {
      const thumb = h('canvas', { class: 'layer-thumb', width: 52, height: 40 });
      this.layerThumbs.push([thumb, L]);
      const row = h('div', { class: 'layer-row' + (L === active ? ' active' : '') + (L.visible ? '' : ' hidden-layer') },
        h('button', {
          class: 'icon-btn eye', title: '表示/非表示', html: icon(L.visible ? 'eye' : 'eyeOff', 16),
          onclick: (e) => { e.stopPropagation(); ed.updateLayer(L, { visible: !L.visible }); },
        }),
        h('button', {
          class: 'icon-btn lock' + (L.locked ? ' on' : ''), title: 'ロック', html: icon(L.locked ? 'lock' : 'unlock', 14),
          onclick: (e) => { e.stopPropagation(); ed.updateLayer(L, { locked: !L.locked }); },
        }),
        thumb,
        h('div', { class: 'layer-name' },
          h('div', { class: 'name' }, L.name),
          h('div', { class: 'meta' },
            `${Math.round(L.opacity * 100)}% ${BLEND_MODES.find((m) => m[0] === L.blend)?.[1] || ''}`,
            L.draft ? h('span', { class: 'badge' }, '下書き') : null)),
      );
      row.addEventListener('click', () => {
        if (L === ed.layer) ed.renameLayer(L);
        else ed.setActiveLayer(L.id);
      });
      this.layerList.append(row);
    }
    this.refreshLayerThumbs();
  }

  refreshLayerThumbs() {
    if (!this.layerThumbs || !this.ed.project) return;
    const { w, h: ph } = this.ed.project.paper;
    for (const [c, L] of this.layerThumbs) {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const s = Math.min(c.width / w, c.height / ph);
      const dw = w * s, dh = ph * s, ox = (c.width - dw) / 2, oy = (c.height - dh) / 2;
      ctx.fillStyle = '#fff';
      ctx.fillRect(ox, oy, dw, dh);
      if (L.canvas) ctx.drawImage(L.canvas, ox, oy, dw, dh);
    }
  }

  // ---------------- ページ管理 ----------------
  buildPages() {
    const box = this.$('#pages');
    this.pageList = h('div', { class: 'page-list' });
    const b = (ic, title, cmd) => h('button', { class: 'icon-btn', title, html: icon(ic, 18), onclick: () => this.ed.command(cmd) });
    box.append(
      h('div', { class: 'pages-head' },
        h('span', { class: 'pal-title' }, 'ページ管理'),
        b('plus', 'ページを追加', 'page-add'), b('copy', 'ページを複製', 'page-dup'),
        b('left', 'ページを前へ移動', 'page-move-left'), b('right', 'ページを後ろへ移動', 'page-move-right'),
        b('trash', 'ページを削除', 'page-del')),
      this.pageList,
    );
  }

  refreshPages() {
    const ed = this.ed;
    if (!ed.project) return;
    this.pageList.innerHTML = '';
    ed.project.pages.forEach((p, i) => {
      const img = h('img', { class: 'page-img', alt: '', draggable: false });
      if (p.thumb) img.src = p.thumb;
      const item = h('button', {
        class: 'page-item' + (i === ed.pageIndex ? ' active' : ''),
        onclick: () => ed.gotoPage(i),
      }, h('div', { class: 'page-frame' }, img), h('div', { class: 'page-no' }, `${i + 1}`));
      if (i === ed.pageIndex) this.currentPageImg = img;
      this.pageList.append(item);
    });
    this.refreshTitle();
    this.pageList.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  refreshCurrentPageThumb() {
    if (!this.ed.project || !this.currentPageImg || this.root.classList.contains('hide-pages')) return;
    const url = this.ed.makeThumb(this.ed.page, 120);
    this.currentPageImg.src = url;
  }

  // ---------------- ヘルプ ----------------
  showHelp() {
    const rows = [
      ['ピンチ', '拡大・縮小・回転'], ['2本指ドラッグ', '表示位置の移動'],
      ['2本指タップ', '取り消し'], ['3本指タップ', 'やり直し'],
      ['Apple Pencil', '描画(Pencil を使うと指は自動で移動専用になります)'],
      ['スペース + ドラッグ', '表示位置の移動(キーボード)'],
      ['⌘Z / ⇧⌘Z', '取り消し / やり直し'], ['⌘S', '保存'], ['⌘D', '選択解除'],
      ['[ / ]', 'ブラシサイズを小さく / 大きく'], ['X', 'メインとサブの色を入れ替え'], ['C', '透明色の切り替え'],
      ['Shift + ツールのキー', 'サブツールの切り替え'], ['Tab', 'パレットの表示切替'], ['R', '回転をリセット'],
      ...TOOLS.filter((t) => t.key).map((t) => [t.key.toUpperCase(), t.label]),
    ];
    showDialog({
      title: '操作方法',
      wide: true,
      body: h('div', {},
        h('div', { class: 'notice-box' },
          '⚠ 作品はこの端末のブラウザ内だけに保存されます。大切な作品は「ファイル → 作品ファイル(.komanote)として保存」でバックアップしてください。 ',
          h('button', { class: 'btn small', onclick: () => showStorageNotice() }, '保存について詳しく')),
        h('table', { class: 'help-table', style: { marginTop: '10px' } }, rows.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b))))),
    });
  }
}
