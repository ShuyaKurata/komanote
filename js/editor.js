// エディタ本体: 表示(拡大・回転・反転)、入力(ペン・タッチ・マウス・キーボード)、
// レイヤー/ページ操作、取り消し、保存をまとめる。

import { clamp, debounce, makeCanvas, releaseCanvas, canvasToBlob, blobToBitmap, isTextInput } from './util.js';
import { History, rasterEntry } from './history.js';
import { StrokeEngine } from './brush.js';
import { renderPage, renderPageTo } from './render.js';
import { createLayer, createPage, clonePage, serializeProject, blobKey } from './model.js';
import { TOOLS, findTool } from './tooldefs.js';
import { createTools } from './tools.js';
import * as storage from './storage.js';
import { UI } from './ui.js';
import { applyTemplate } from './panels.js';
import { pointInPolygon, polyToPath, polyBounds } from './geometry.js';
import { applyPaint } from './paint-tools.js';
import { toast, confirmDialog, promptDialog } from './dialog.js';

const MIN_SCALE = 0.02, MAX_SCALE = 32;
const LS_TOOLS = 'komanote.toolSettings.v1';
const LS_PREFS = 'komanote.prefs.v1';

function loadJson(key, def) {
  try { return { ...def, ...JSON.parse(localStorage.getItem(key) || '{}') }; } catch { return { ...def }; }
}

export class Editor {
  constructor(root, { onExit }) {
    this.root = root;
    this.onExit = onExit;
    this.wrap = root.querySelector('#canvas-wrap');
    this.canvas = root.querySelector('#view');
    this.ctx = this.canvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;

    this.project = null;
    this.pageIndex = 0;
    this.view = { tx: 0, ty: 0, scale: 1, rot: 0, flip: false };
    this.color = { main: '#000000', sub: '#ffffff', which: 'main', transparent: false };
    this.recentColors = [];

    const saved = loadJson(LS_TOOLS, { settings: {}, currentSub: {}, toolId: 'pen', color: null });
    this.toolSettings = saved.settings;
    this.currentSub = saved.currentSub;
    this.toolId = findTool(saved.toolId) ? saved.toolId : 'pen';
    this.prefs = loadJson(LS_PREFS, { fingerDraw: 'auto', showGuides: true, allowRotate: true });

    this.history = new History({ onChange: () => this.ui?.refreshUndo() });
    this.pointers = new Map();
    this.gesture = null;
    this.active = null;
    this.panState = null;
    this.penSeen = false;
    this.spaceDown = false;
    this.hover = null;
    this.selection = null;
    this.changeSeq = 0;
    this.savedSeq = 0;
    this.saveChain = Promise.resolve();

    this.toolImpls = createTools(this);
    this.ui = new UI(this);
    this.autosave = debounce(() => this.save(), 2500);
    this.bindEvents();
  }

  // ------------------------------------------------------------------
  // 作品を開く/閉じる
  // ------------------------------------------------------------------
  async open(project) {
    this.project = project;
    this.pageIndex = clamp(project.currentPage || 0, 0, project.pages.length - 1);
    this.engine?.release();
    this.engine = new StrokeEngine(project.paper.w, project.paper.h);
    this.history.clear();
    this.selection = null;
    await this.loadPage(this.page);
    this.changeSeq = this.savedSeq = 0;
    this.resize();
    this.fit();
    this.setTool(this.toolId);
    this.ui.refreshAll();
    this.requestRender();
  }

  async close() {
    if (this.tool?.active) this.tool.confirm();
    this.flushLive();
    this.tool?.cancel?.();
    this.tool?.deactivate?.();
    await this.save();
    if (this.project) this.unloadPage(this.page);
    this.engine?.release();
    this.engine = null;
    this.project = null;
    this.history.clear();
  }

  get page() { return this.project.pages[this.pageIndex]; }
  get layer() {
    const p = this.page;
    return p.layers.find((L) => L.id === p.activeLayerId) || p.layers[p.layers.length - 1];
  }

  /** 描画できるレイヤーを返す。描けないときは理由を表示して null */
  editableLayer() {
    const L = this.layer;
    if (!L?.canvas) return null;
    if (L.locked) { toast('レイヤーがロックされています'); return null; }
    if (!L.visible) { toast('非表示のレイヤーには描けません'); return null; }
    return L;
  }

  async loadPage(page) {
    const { w, h } = this.project.paper;
    await Promise.all(page.layers.map(async (L) => {
      L.canvas = makeCanvas(w, h);
      L.dirty = false;
      const blob = await storage.getBlob(blobKey(this.project.id, L.id));
      if (blob) {
        const bmp = await blobToBitmap(blob);
        L.canvas.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close?.();
      }
    }));
  }

  unloadPage(page) {
    for (const L of page.layers) { releaseCanvas(L.canvas); L.canvas = null; }
  }

  // ------------------------------------------------------------------
  // ツール
  // ------------------------------------------------------------------
  toolDef(id = this.toolId) { return findTool(id); }
  subtoolDef(toolId = this.toolId) {
    const t = findTool(toolId);
    return t.subtools.find((s) => s.id === this.currentSub[toolId]) || t.subtools[0];
  }
  /** 現在のサブツールの設定(初期値 + ユーザー変更) */
  settings(toolId = this.toolId) {
    return this.settingsFor(toolId, this.subtoolDef(toolId).id);
  }
  settingsFor(toolId, subId) {
    const sub = findTool(toolId).subtools.find((x) => x.id === subId);
    const key = `${toolId}/${sub.id}`;
    if (!this.toolSettings[key]) this.toolSettings[key] = {};
    const s = this.toolSettings[key];
    for (const [k, v] of Object.entries(sub.settings)) if (!(k in s)) s[k] = v;
    return s;
  }
  resetSubtool() {
    const sub = this.subtoolDef();
    this.toolSettings[`${this.toolId}/${sub.id}`] = { ...sub.settings };
    this.saveToolPrefs();
    this.ui.refreshToolProps();
  }
  saveToolPrefs() {
    localStorage.setItem(LS_TOOLS, JSON.stringify({ settings: this.toolSettings, currentSub: this.currentSub, toolId: this.toolId }));
  }
  savePrefs() { localStorage.setItem(LS_PREFS, JSON.stringify(this.prefs)); }

  setTool(id) {
    if (!findTool(id)) return;
    if (this.tool?.active && this.tool.confirm) this.tool.confirm();
    if (this.active) { this.tool?.cancel?.(); this.active = null; }
    this.tool?.deactivate?.();
    this.toolId = id;
    const sub = this.subtoolDef();
    this.tool = this.toolImpls[sub.kind] || this.toolImpls.hand;
    this.tool.activate?.();
    this.canvas.style.cursor = this.tool.cursor || 'default';
    this.saveToolPrefs();
    this.ui.refreshTools();
    this.ui.refreshFloat();
    this.requestRender();
  }

  /** 変形のように、一時的にツールを差し替える */
  enterTempTool(tool) {
    this.tool?.deactivate?.();
    this.tool = tool;
    this.canvas.style.cursor = tool.cursor || 'default';
    this.ui.refreshToolProps();
    this.ui.refreshFloat();
    this.requestRender();
  }
  exitTempTool() { this.setTool(this.toolId); }

  setSelection(sel) {
    this.selection = sel;
    this.ui.refreshFloat();
    this.ui.refreshToolProps();
    this.requestRender();
  }

  /** 効果線などを描く範囲: 選択範囲 > 点を含むコマ > ページ全体 */
  regionAt(x, y) {
    if (this.selection) return { path: this.selection.path, bounds: this.selection.bounds };
    const pn = [...this.page.panels].reverse().find((p) => pointInPolygon(x, y, p.points));
    if (pn && this.page.showPanels) return { path: polyToPath(pn.points), bounds: polyBounds(pn.points) };
    const { w, h } = this.project.paper;
    return { path: null, bounds: { x: 0, y: 0, w, h } };
  }
  setSubtool(subId) {
    this.currentSub[this.toolId] = subId;
    this.setTool(this.toolId);
  }

  // ------------------------------------------------------------------
  // 色
  // ------------------------------------------------------------------
  currentColor() { return this.color[this.color.which]; }
  setColor(hex, { record = true } = {}) {
    this.color[this.color.which] = hex;
    this.color.transparent = false;
    if (record) {
      this.recentColors = [hex, ...this.recentColors.filter((c) => c !== hex)].slice(0, 10);
    }
    this.ui.refreshColor();
  }
  setTransparent(on) { this.color.transparent = on; this.ui.refreshColor(); }
  selectColorSlot(which) { this.color.which = which; this.color.transparent = false; this.ui.refreshColor(); }
  swapColors() {
    [this.color.main, this.color.sub] = [this.color.sub, this.color.main];
    this.ui.refreshColor();
  }

  // ------------------------------------------------------------------
  // 表示(ビュー変換)
  // ------------------------------------------------------------------
  matrix() {
    const v = this.view, P = this.project.paper;
    return new DOMMatrix().translate(v.tx, v.ty).rotate(v.rot)
      .scale(v.flip ? -v.scale : v.scale, v.scale).translate(-P.w / 2, -P.h / 2);
  }
  toPage(sx, sy) {
    const p = this.matrix().inverse().transformPoint(new DOMPoint(sx, sy));
    return { x: p.x, y: p.y };
  }
  toScreen(x, y) {
    const p = this.matrix().transformPoint(new DOMPoint(x, y));
    return { x: p.x, y: p.y };
  }
  /** ページ上の点 pagePt が画面上の screenPt に来るように平行移動する */
  anchorView(pagePt, screenPt) {
    this.view.tx = 0; this.view.ty = 0;
    const s = this.toScreen(pagePt.x, pagePt.y);
    this.view.tx = screenPt.x - s.x;
    this.view.ty = screenPt.y - s.y;
    this.viewChanged();
  }
  viewSize() { return { w: this.wrap.clientWidth, h: this.wrap.clientHeight }; }
  center() { const s = this.viewSize(); return { x: s.w / 2, y: s.h / 2 }; }
  fit() {
    const { w, h } = this.viewSize(), P = this.project.paper;
    const s = Math.min((w - 40) / P.w, (h - 40) / P.h);
    Object.assign(this.view, { tx: w / 2, ty: h / 2, scale: clamp(s, MIN_SCALE, MAX_SCALE), rot: 0 });
    this.viewChanged();
  }
  fitWidth() {
    const { w } = this.viewSize(), P = this.project.paper;
    const c = this.toPage(this.center().x, this.center().y);
    this.view.scale = clamp((w - 40) / P.w, MIN_SCALE, MAX_SCALE);
    this.view.rot = 0;
    this.anchorView({ x: P.w / 2, y: clamp(c.y, 0, P.h) }, this.center());
  }
  zoomAt(screenPt, scale) {
    const pp = this.toPage(screenPt.x, screenPt.y);
    this.view.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
    this.anchorView(pp, screenPt);
  }
  zoomBy(f) { this.zoomAt(this.center(), this.view.scale * f); }
  /** 100% = 原稿の 1px が画面の 1 物理ピクセル */
  zoomActual() { this.zoomAt(this.center(), 1 / this.dpr); }
  rotateTo(deg) {
    const c = this.center(), pp = this.toPage(c.x, c.y);
    let r = ((deg + 180) % 360 + 360) % 360 - 180;
    this.view.rot = r;
    this.anchorView(pp, c);
  }
  toggleFlip() {
    const c = this.center(), pp = this.toPage(c.x, c.y);
    this.view.flip = !this.view.flip;
    this.anchorView(pp, c);
    toast(this.view.flip ? '左右反転表示中' : '左右反転を解除');
  }
  viewChanged() {
    this.requestRender();
    this.ui?.refreshNav();
  }

  resize() {
    const { w, h } = this.viewSize();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.requestRender();
  }

  // ------------------------------------------------------------------
  // 描画
  // ------------------------------------------------------------------
  requestRender() {
    if (this._raf || !this.project) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this.render(); });
  }

  render() {
    if (!this.project) return;
    const ctx = this.ctx, dpr = this.dpr, P = this.project.paper;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#5a5a5a';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const m = this.matrix();
    ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.e, dpr * m.f);
    const px = 1 / (this.view.scale * dpr);
    // 用紙の影
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(4 * px * dpr, 4 * px * dpr, P.w, P.h);
    ctx.imageSmoothingEnabled = this.view.scale * dpr < 2;
    renderPage(ctx, this.project, this.page, {
      guides: this.prefs.showGuides,
      px: 1 / this.view.scale,
      afterLayer: (c, L) => this.tool?.afterLayer?.(c, L),
    });
    ctx.imageSmoothingEnabled = true;
    if (this.selection) this.drawSelection(ctx, 1 / this.view.scale);
    this.tool?.overlay?.(ctx, 1 / this.view.scale);
    if (this.tool?.showBrushCursor && this.hover && !this.gesture) this.drawBrushCursor(ctx, 1 / this.view.scale);
  }

  drawBrushCursor(ctx, px) {
    const s = this.settings();
    const r = Math.max((s.size || 1) / 2, 0);
    const { x, y } = this.hover;
    ctx.save();
    ctx.lineWidth = px;
    if (r / px > 3) {
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(x, y, r + px, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.stroke();
    } else {
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.beginPath();
      ctx.moveTo(x - 6 * px, y); ctx.lineTo(x + 6 * px, y);
      ctx.moveTo(x, y - 6 * px); ctx.lineTo(x, y + 6 * px);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawSelection(ctx, px) {
    ctx.save();
    ctx.lineWidth = px;
    ctx.strokeStyle = '#000';
    ctx.setLineDash([4 * px, 4 * px]);
    ctx.stroke(this.selection.path);
    ctx.strokeStyle = '#fff';
    ctx.lineDashOffset = 4 * px;
    ctx.stroke(this.selection.path);
    ctx.restore();
  }

  selectionPath() { return this.selection?.path || null; }

  // ------------------------------------------------------------------
  // 入力
  // ------------------------------------------------------------------
  bindEvents() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e, false));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'touch' && !this.active) { this.hover = null; this.requestRender(); }
    });
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) {
      document.addEventListener(ev, (e) => e.preventDefault());
    }
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => { if (e.key === ' ') this.spaceDown = false; });
    new ResizeObserver(() => { if (this.project) { this.resize(); this.ui.refreshNav(); } }).observe(this.wrap);
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.project) this.save(); });
    window.addEventListener('pagehide', () => { if (this.project) this.save(); });
  }

  fingerDraws() {
    return this.prefs.fingerDraw === 'on' || (this.prefs.fingerDraw === 'auto' && !this.penSeen);
  }

  pt(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const q = this.toPage(sx, sy);
    let pressure = 1;
    if (e.pointerType === 'pen') pressure = clamp(e.pressure || 0, 0.03, 1);
    return { x: q.x, y: q.y, sx, sy, pressure, pointerType: e.pointerType, shift: e.shiftKey, alt: e.altKey };
  }

  touchPts() { return [...this.pointers.values()].filter((q) => q.type === 'touch'); }

  onDown(e) {
    if (!this.project || this.busy) return;
    e.preventDefault();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* 無視 */ }
    const p = this.pt(e);
    if (e.pointerType === 'pen' && !this.penSeen) {
      this.penSeen = true;
      this.ui.refreshFingerMode();
    }
    this.pointers.set(e.pointerId, { type: e.pointerType, sx: p.sx, sy: p.sy, x0: p.sx, y0: p.sy });

    if (e.pointerType === 'touch') {
      const n = this.touchPts().length;
      if (this.gesture || n >= 2 || !this.fingerDraws()) {
        if (this.active?.type === 'touch') { this.tool?.cancel?.(); this.active = null; }
        this.startGesture();
        return;
      }
    }
    if (this.gesture || this.active) return;
    if ((e.pointerType === 'mouse' && e.button === 1) || this.spaceDown) {
      this.panState = { id: e.pointerId, anchor: { x: p.x, y: p.y } };
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.active = { id: e.pointerId, type: e.pointerType };
    this.hover = p;
    this.tool?.down(p, e);
  }

  onMove(e) {
    if (!this.project) return;
    const q = this.pointers.get(e.pointerId);
    const p = this.pt(e);
    if (q) { q.sx = p.sx; q.sy = p.sy; }
    if (this.gesture && q?.type === 'touch') { this.updateGesture(); return; }
    if (this.panState?.id === e.pointerId) { this.anchorView(this.panState.anchor, { x: p.sx, y: p.sy }); return; }
    if (this.active?.id === e.pointerId) {
      const list = e.getCoalescedEvents?.() || [];
      if (list.length > 1) for (const ev of list) this.tool?.move(this.pt(ev), ev);
      else this.tool?.move(p, e);
      this.hover = p;
      return;
    }
    if (e.pointerType !== 'touch') {
      this.hover = p;
      this.tool?.hover?.(p);
      if (this.tool?.showBrushCursor || this.tool?.hover) this.requestRender();
    }
  }

  onUp(e, cancelled) {
    const q = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.gesture && q?.type === 'touch') {
      if (this.touchPts().length === 0) this.endGesture();
      else this.rebaseGesture();
      return;
    }
    if (this.panState?.id === e.pointerId) { this.panState = null; return; }
    if (this.active?.id === e.pointerId) {
      this.active = null;
      if (cancelled) this.tool?.cancel?.();
      else this.tool?.up(this.pt(e), e);
    }
  }

  startGesture() {
    if (!this.gesture) this.gesture = { t0: performance.now(), max: 0, moved: false };
    this.rebaseGesture();
  }

  rebaseGesture() {
    const g = this.gesture, t = this.touchPts();
    g.max = Math.max(g.max, t.length);
    if (t.length === 1) {
      g.mode = 'pan';
      g.anchor = this.toPage(t[0].sx, t[0].sy);
    } else if (t.length >= 2) {
      const [a, b] = t;
      const mid = { x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 };
      g.mode = 'pinch';
      g.anchor = this.toPage(mid.x, mid.y);
      g.d0 = Math.hypot(b.sx - a.sx, b.sy - a.sy) || 1;
      g.a0 = Math.atan2(b.sy - a.sy, b.sx - a.sx);
      g.s0 = this.view.scale;
      g.r0 = this.view.rot;
    }
  }

  updateGesture() {
    const g = this.gesture, t = this.touchPts();
    for (const q of t) if (Math.hypot(q.sx - q.x0, q.sy - q.y0) > 12) g.moved = true;
    if (t.length === 1 && g.mode === 'pan') {
      this.anchorView(g.anchor, { x: t[0].sx, y: t[0].sy });
    } else if (t.length >= 2 && g.mode === 'pinch') {
      const [a, b] = t;
      const mid = { x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 };
      const d = Math.hypot(b.sx - a.sx, b.sy - a.sy);
      this.view.scale = clamp((g.s0 * d) / g.d0, MIN_SCALE, MAX_SCALE);
      if (this.prefs.allowRotate) {
        let r = g.r0 + ((Math.atan2(b.sy - a.sy, b.sx - a.sx) - g.a0) * 180) / Math.PI;
        r = ((r + 180) % 360 + 360) % 360 - 180;
        if (Math.abs(r) < 4) r = 0;
        this.view.rot = r;
      }
      this.anchorView(g.anchor, mid);
    }
  }

  endGesture() {
    const g = this.gesture;
    this.gesture = null;
    // 2 本指タップ = 取り消し / 3 本指タップ = やり直し
    if (!g.moved && performance.now() - g.t0 < 350) {
      if (g.max === 2) this.undo();
      else if (g.max >= 3) this.redo();
    }
    this.requestRender();
  }

  onWheel(e) {
    if (!this.project) return;
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
    if (e.ctrlKey || e.metaKey) {
      this.zoomAt(pt, this.view.scale * Math.exp(-e.deltaY * 0.01));
    } else if (e.altKey) {
      this.rotateTo(this.view.rot + (e.deltaY > 0 ? 5 : -5));
    } else {
      this.view.tx -= e.deltaX;
      this.view.ty -= e.deltaY;
      this.viewChanged();
    }
  }

  onKeyDown(e) {
    if (!this.project || this.root.classList.contains('hidden')) return;
    if (isTextInput(document.activeElement) || document.querySelector('.overlay')) return;
    if (this.tool?.onKey?.(e)) { e.preventDefault(); return; }
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod) {
      const map = {
        z: e.shiftKey ? 'redo' : 'undo', y: 'redo', s: 'save', d: 'deselect', a: 'select-all', t: 'transform',
        0: 'fit', 1: 'zoom-100', '=': 'zoom-in', '+': 'zoom-in', ';': 'zoom-in', '-': 'zoom-out',
      };
      if (map[k]) { e.preventDefault(); this.command(map[k]); }
      return;
    }
    if (e.key === ' ') { this.spaceDown = true; e.preventDefault(); return; }
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); this.command('clear'); return; }
    if (k === '[' || k === ']') {
      const s = this.settings();
      if ('size' in s) {
        s.size = clamp(s.size * (k === ']' ? 1.15 : 1 / 1.15), 0.5, 600);
        this.saveToolPrefs();
        this.ui.refreshToolProps();
        this.requestRender();
      }
      return;
    }
    if (k === 'x') { this.swapColors(); return; }
    if (k === 'c') { this.setTransparent(!this.color.transparent); return; }
    if (k === 'tab') { e.preventDefault(); this.command('toggle-palettes'); return; }
    if (k === 'r') { this.command('rotate-reset'); return; }
    if (k === 'enter') { this.tool?.confirm?.(); return; }
    if (k === 'escape') { this.tool?.escape?.(); return; }
    const t = TOOLS.find((x) => x.key === k);
    if (t) {
      if (t.id === this.toolId && e.shiftKey) {
        // Shift + 同じキーでサブツールを切り替え
        const subs = t.subtools, i = subs.indexOf(this.subtoolDef());
        this.setSubtool(subs[(i + 1) % subs.length].id);
      } else this.setTool(t.id);
    }
  }

  // ------------------------------------------------------------------
  // 変更通知・取り消し
  // ------------------------------------------------------------------
  /** 何か変更されたら呼ぶ。自動保存とサムネイル更新を予約する */
  changed() {
    this.changeSeq++;
    this.pageThumbDirty = true;
    this.ui.setStatus('未保存');
    this.ui.scheduleThumbs();
    this.autosave();
    this.requestRender();
  }

  pushHistory(entry) {
    this.history.push(entry);
    this.changed();
  }

  pushRaster(label, layer, rect, before, after) {
    layer.dirty = true;
    this.pushHistory(rasterEntry(label, layer, rect, before, after, () => this.changed()));
  }

  /** レイヤー全体を書き換える操作を履歴付きで行う */
  rasterOp(label, layer, fn) {
    const { w, h } = this.project.paper;
    const ctx = layer.canvas.getContext('2d');
    const before = ctx.getImageData(0, 0, w, h);
    fn(ctx);
    const after = ctx.getImageData(0, 0, w, h);
    this.pushRaster(label, layer, { x: 0, y: 0, w, h }, before, after);
  }

  /** コマ・テキストなどのオブジェクト変更を履歴に積むためのスナップショット */
  snapshotObjects(page = this.page) {
    return JSON.stringify({ panels: page.panels, items: page.items, panelStyle: page.panelStyle, maskOutside: page.maskOutside });
  }
  commitObjects(label, before, page = this.page) {
    const after = this.snapshotObjects(page);
    if (after === before) return;
    const apply = (json) => {
      Object.assign(page, JSON.parse(json));
      this.tool?.objectsRestored?.();
      this.ui.refreshToolProps();
      this.ui.refreshLayers();
      this.changed();
    };
    this.ui.refreshLayers();
    this.pushHistory({ label, bytes: before.length + after.length, undo: () => apply(before), redo: () => apply(after) });
  }

  /**
   * スライダーなどで連続して変更するとき用。最初の変更前の状態を覚えておき、
   * 操作が止まってから 1 回だけ履歴に積む。
   */
  live(label, fn) {
    if (!this._live) this._live = { before: this.snapshotObjects(), label, page: this.page };
    fn();
    this.requestRender();
    clearTimeout(this._liveTimer);
    this._liveTimer = setTimeout(() => this.flushLive(), 450);
  }
  flushLive() {
    clearTimeout(this._liveTimer);
    const l = this._live;
    this._live = null;
    if (l) this.commitObjects(l.label, l.before, l.page);
  }

  undo() {
    if (this.active) return;
    this.flushLive();
    this.tool?.beforeUndo?.();
    const e = this.history.undo();
    if (e) { toast(`取り消し: ${e.label}`, 900); this.ui.refreshLayers(); }
    this.requestRender();
  }
  redo() {
    if (this.active) return;
    this.tool?.beforeUndo?.();
    const e = this.history.redo();
    if (e) { toast(`やり直し: ${e.label}`, 900); this.ui.refreshLayers(); }
    this.requestRender();
  }

  // ------------------------------------------------------------------
  // レイヤー操作
  // ------------------------------------------------------------------
  setActiveLayer(id) {
    this.page.activeLayerId = id;
    this.ui.refreshLayers();
  }

  layerStructureEntry(label, page, beforeLayers, beforeActive) {
    const afterLayers = [...page.layers], afterActive = page.activeLayerId;
    const set = (layers, active) => {
      page.layers = [...layers];
      page.activeLayerId = active;
      for (const L of page.layers) L.dirty = true;
      this.ui.refreshLayers();
      this.changed();
    };
    return { label, undo: () => set(beforeLayers, beforeActive), redo: () => set(afterLayers, afterActive) };
  }

  addLayer(opts = {}) {
    const page = this.page, before = [...page.layers], beforeActive = page.activeLayerId;
    const n = page.layers.length + 1;
    const L = createLayer(opts.name || (opts.draft ? `下書き ${n}` : `レイヤー ${n}`), opts);
    L.canvas = makeCanvas(this.project.paper.w, this.project.paper.h);
    L.dirty = true;
    const i = page.layers.indexOf(this.layer);
    page.layers.splice(i + 1, 0, L);
    page.activeLayerId = L.id;
    this.pushHistory(this.layerStructureEntry('レイヤー追加', page, before, beforeActive));
    this.ui.refreshLayers();
    return L;
  }

  duplicateLayer() {
    const page = this.page, src = this.layer, before = [...page.layers], beforeActive = page.activeLayerId;
    const L = createLayer(src.name + ' のコピー', {
      opacity: src.opacity, blend: src.blend, draft: src.draft,
    });
    L.canvas = makeCanvas(this.project.paper.w, this.project.paper.h);
    L.canvas.getContext('2d').drawImage(src.canvas, 0, 0);
    L.dirty = true;
    page.layers.splice(page.layers.indexOf(src) + 1, 0, L);
    page.activeLayerId = L.id;
    this.pushHistory(this.layerStructureEntry('レイヤー複製', page, before, beforeActive));
    this.ui.refreshLayers();
  }

  deleteLayer() {
    const page = this.page;
    if (page.layers.length <= 1) { toast('最後のレイヤーは削除できません'); return; }
    const before = [...page.layers], beforeActive = page.activeLayerId;
    const i = page.layers.indexOf(this.layer);
    page.layers.splice(i, 1);
    page.activeLayerId = page.layers[Math.max(0, i - 1)].id;
    this.pushHistory(this.layerStructureEntry('レイヤー削除', page, before, beforeActive));
    this.ui.refreshLayers();
  }

  moveLayer(dir) {
    const page = this.page, i = page.layers.indexOf(this.layer), j = i + dir;
    if (j < 0 || j >= page.layers.length) return;
    const before = [...page.layers];
    [page.layers[i], page.layers[j]] = [page.layers[j], page.layers[i]];
    this.pushHistory(this.layerStructureEntry('レイヤー移動', page, before, page.activeLayerId));
    this.ui.refreshLayers();
  }

  mergeDown() {
    const page = this.page, upper = this.layer, i = page.layers.indexOf(upper);
    if (i <= 0) { toast('下にレイヤーがありません'); return; }
    const lower = page.layers[i - 1];
    if (lower.locked) { toast('下のレイヤーがロックされています'); return; }
    const { w, h } = this.project.paper;
    const lctx = lower.canvas.getContext('2d');
    const before = lctx.getImageData(0, 0, w, h);
    lctx.save();
    lctx.globalAlpha = upper.opacity;
    lctx.globalCompositeOperation = upper.blend;
    lctx.drawImage(upper.canvas, 0, 0);
    lctx.restore();
    const after = lctx.getImageData(0, 0, w, h);
    const layersBefore = [...page.layers];
    page.layers.splice(i, 1);
    page.activeLayerId = lower.id;
    const layersAfter = [...page.layers];
    const set = (layers, img, active) => {
      page.layers = [...layers];
      lctx.putImageData(img, 0, 0);
      page.activeLayerId = active;
      for (const L of page.layers) L.dirty = true;
      this.ui.refreshLayers();
      this.changed();
    };
    lower.dirty = true;
    this.pushHistory({
      label: '下のレイヤーと結合', bytes: before.data.length * 2,
      undo: () => set(layersBefore, before, upper.id),
      redo: () => set(layersAfter, after, lower.id),
    });
    this.ui.refreshLayers();
  }

  updateLayer(L, props) {
    Object.assign(L, props);
    this.ui.refreshLayers();
    this.changed();
  }

  async renameLayer(L) {
    const name = await promptDialog('レイヤー名の変更', 'レイヤー名', L.name);
    if (name) this.updateLayer(L, { name });
  }

  clearLayer() {
    const L = this.editableLayer();
    if (!L) return;
    const sel = this.selectionPath();
    this.rasterOp(sel ? '選択範囲を消去' : 'レイヤーを消去', L, (ctx) => {
      const { w, h } = this.project.paper;
      if (sel) {
        ctx.save();
        ctx.clip(sel);
        ctx.clearRect(0, 0, w, h);
        ctx.restore();
      } else ctx.clearRect(0, 0, w, h);
    });
  }

  // ------------------------------------------------------------------
  // ページ操作
  // ------------------------------------------------------------------
  async gotoPage(i) {
    const pages = this.project.pages;
    if (i === this.pageIndex || i < 0 || i >= pages.length || this.busy) return;
    this.busy = true;
    try {
      if (this.tool?.active) this.tool.confirm();
      this.tool?.cancel?.();
      this.tool?.deactivate?.();
      this.flushLive();
      await this.save();
      this.unloadPage(this.page);
      this.pageIndex = i;
      this.project.currentPage = i;
      await this.loadPage(this.page);
      this.history.clear();
      this.selection = null;
      this.tool?.activate?.();
      this.ui.refreshAll();
      this.requestRender();
    } finally {
      this.busy = false;
    }
  }

  newPageObject() {
    const page = createPage(this.project.paper);
    applyTemplate(page, this.project.paper, this.project.pageTemplate);
    return page;
  }

  async addPage() {
    const page = this.newPageObject();
    this.project.pages.splice(this.pageIndex + 1, 0, page);
    this.changed();
    await this.gotoPage(this.pageIndex + 1);
  }

  async duplicatePage() {
    await this.save();
    const { page, idMap } = clonePage(this.page);
    for (const [from, to] of Object.entries(idMap)) {
      await storage.copyBlob(blobKey(this.project.id, from), blobKey(this.project.id, to));
    }
    this.project.pages.splice(this.pageIndex + 1, 0, page);
    this.changed();
    await this.gotoPage(this.pageIndex + 1);
    toast('ページを複製しました');
  }

  async deletePage() {
    const pages = this.project.pages;
    if (pages.length <= 1) { toast('最後のページは削除できません'); return; }
    if (!(await confirmDialog('ページの削除', `${this.pageIndex + 1} ページ目を削除します。この操作は取り消せません。`, '削除', true))) return;
    this.tool?.cancel?.();
    this.unloadPage(this.page);
    pages.splice(this.pageIndex, 1);
    this.pageIndex = Math.min(this.pageIndex, pages.length - 1);
    this.project.currentPage = this.pageIndex;
    await this.loadPage(this.page);
    this.history.clear();
    this.selection = null;
    this.changed();
    this.ui.refreshAll();
    await this.save();
  }

  movePage(dir) {
    const pages = this.project.pages, i = this.pageIndex, j = i + dir;
    if (j < 0 || j >= pages.length) return;
    [pages[i], pages[j]] = [pages[j], pages[i]];
    this.pageIndex = j;
    this.project.currentPage = j;
    this.changed();
    this.ui.refreshPages();
  }

  // ------------------------------------------------------------------
  // 保存
  // ------------------------------------------------------------------
  makeThumb(page = this.page, height = 220) {
    const { w, h } = this.project.paper;
    const s = height / h;
    const c = makeCanvas(Math.max(24, w * s), height);
    renderPageTo(c, this.project, page, { includeDraft: false });
    const url = c.toDataURL('image/jpeg', 0.75);
    releaseCanvas(c);
    return url;
  }

  save() {
    this.autosave.cancel();
    this.saveChain = this.saveChain
      .then(() => this.doSave())
      .catch((err) => {
        console.error(err);
        this.ui.setStatus('保存エラー');
        toast('保存に失敗しました: ' + err.message, 5000);
      });
    return this.saveChain;
  }

  async doSave() {
    const project = this.project;
    if (!project) return;
    const seq = this.changeSeq;
    if (seq === this.savedSeq) return;
    this.ui.setStatus('保存中…');
    const page = this.page;
    for (const L of page.layers) {
      if (L.canvas && L.dirty) {
        L.dirty = false;
        const blob = await canvasToBlob(L.canvas);
        await storage.putBlob(blobKey(project.id, L.id), blob);
      }
    }
    if (this.pageThumbDirty) {
      this.pageThumbDirty = false;
      page.thumb = this.makeThumb(page);
      this.ui.refreshPages();
    }
    project.updatedAt = Date.now();
    project.currentPage = this.pageIndex;
    await storage.putProject(serializeProject(project));
    // 削除されたレイヤーの画素データを掃除する
    const keep = new Set(project.pages.flatMap((p) => p.layers.map((L) => blobKey(project.id, L.id))));
    for (const k of await storage.listBlobKeys(project.id)) if (!keep.has(k)) await storage.deleteBlob(k);
    this.savedSeq = seq;
    this.ui.setStatus(this.changeSeq === seq ? '保存済み' : '未保存');
  }

  async renameProject() {
    const name = await promptDialog('作品名の変更', '作品名', this.project.name);
    if (name) {
      this.project.name = name;
      this.ui.refreshTitle();
      this.changed();
    }
  }

  // ------------------------------------------------------------------
  // コマンド(メニュー・ショートカット・ボタンから呼ばれる)
  // ------------------------------------------------------------------
  async command(cmd, arg) {
    if (!this.project) return;
    const fn = this.commands()[cmd];
    if (fn) await fn(arg);
    else toast(`未対応のコマンド: ${cmd}`);
  }

  commands() {
    return {
      home: () => this.onExit(),
      save: async () => { await this.save(); toast('保存しました'); },
      rename: () => this.renameProject(),
      undo: () => this.undo(),
      redo: () => this.redo(),
      clear: () => this.clearLayer(),
      deselect: () => this.setSelection(null),
      'select-all': () => {
        const { w, h } = this.project.paper, path = new Path2D();
        path.rect(0, 0, w, h);
        this.setSelection({ path, bounds: { x: 0, y: 0, w, h } });
      },
      transform: () => this.toolImpls.transform.start(),
      'fill-selection': () => {
        const L = this.editableLayer();
        if (!L || !this.selection) { if (!this.selection) toast('選択範囲がありません'); return; }
        applyPaint(this, L, this.selection.bounds, {
          path: this.selection.path, label: '選択範囲を塗りつぶし',
          paint: { type: 'color', color: this.color.transparent ? '#000' : this.currentColor(), erase: this.color.transparent },
        });
      },
      'tone-selection': () => {
        if (!this.selection) { toast('選択範囲がありません'); return; }
        const t = this.settingsFor('fill', 'tone');
        const L = this.addLayer({ name: `トーン ${t.lpi}線 ${Math.round(t.density * 100)}%` });
        applyPaint(this, L, this.selection.bounds, {
          path: this.selection.path, label: 'トーンを貼る',
          paint: { type: 'tone', color: '#000000', lpi: t.lpi, density: t.density, angle: t.angle },
        });
      },
      'layer-add': () => this.addLayer(),
      'layer-add-draft': () => this.addLayer({ draft: true, opacity: 0.6 }),
      'layer-dup': () => this.duplicateLayer(),
      'layer-del': () => this.deleteLayer(),
      'layer-up': () => this.moveLayer(1),
      'layer-down': () => this.moveLayer(-1),
      'layer-merge': () => this.mergeDown(),
      'page-add': () => this.addPage(),
      'page-dup': () => this.duplicatePage(),
      'page-del': () => this.deletePage(),
      'page-prev': () => this.gotoPage(this.pageIndex - 1),
      'page-next': () => this.gotoPage(this.pageIndex + 1),
      'page-move-left': () => this.movePage(-1),
      'page-move-right': () => this.movePage(1),
      fit: () => this.fit(),
      'fit-width': () => this.fitWidth(),
      'zoom-100': () => this.zoomActual(),
      'zoom-in': () => this.zoomBy(1.25),
      'zoom-out': () => this.zoomBy(0.8),
      flip: () => this.toggleFlip(),
      'rotate-left': () => this.rotateTo(this.view.rot - 15),
      'rotate-right': () => this.rotateTo(this.view.rot + 15),
      'rotate-reset': () => this.rotateTo(0),
      'toggle-guides': () => { this.prefs.showGuides = !this.prefs.showGuides; this.savePrefs(); this.requestRender(); this.ui.refreshMenus(); },
      'toggle-rotate': () => { this.prefs.allowRotate = !this.prefs.allowRotate; this.savePrefs(); this.ui.refreshMenus(); },
      'finger-mode': (mode) => { this.prefs.fingerDraw = mode; this.savePrefs(); this.ui.refreshFingerMode(); this.ui.refreshMenus(); },
      'toggle-palettes': () => this.ui.togglePalettes(),
      'toggle-left': () => this.ui.toggleDock('left'),
      'toggle-right': () => this.ui.toggleDock('right'),
      'toggle-pages': () => this.ui.toggleDock('pages'),
      help: () => this.ui.showHelp(),
    };
  }
}

