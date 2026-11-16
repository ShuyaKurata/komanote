// 起動処理と作品一覧(ホーム画面)

import { h, formatDate } from './util.js';
import { icon } from './icons.js';
import { PRESETS, DPI_OPTIONS, buildPaper } from './paper.js';
import { createProject, serializeProject } from './model.js';
import * as storage from './storage.js';
import { Editor } from './editor.js';
import { TEMPLATES, applyTemplate } from './panels.js';
import { showDialog, confirmDialog, promptDialog, toast } from './dialog.js';
import { importProjectFile, exportProjectById } from './export.js';
import { showStorageNotice, showStorageNoticeOnce } from './notice.js';
import { linkSupported, startLink, stopLink, openLinkedFile, ensureLinkPermission } from './filelink.js';

export const APP_VERSION = '1.3.0';

const home = document.getElementById('home');
home.querySelector('.logo small').textContent = `漫画制作アプリ v${APP_VERSION}`;
const editorRoot = document.getElementById('editor');

const editor = new Editor(editorRoot, { onExit: () => closeEditor() });

async function openEditor(project) {
  home.classList.add('hidden');
  editorRoot.classList.remove('hidden');
  await editor.open(project);
}

async function closeEditor() {
  await editor.close();
  editorRoot.classList.add('hidden');
  home.classList.remove('hidden');
  renderHome();
}

// ---------------- ホーム画面 ----------------
async function renderHome() {
  const grid = home.querySelector('#project-grid');
  grid.innerHTML = '';
  let list = [];
  try {
    list = await storage.listProjects();
  } catch (err) {
    grid.append(h('p', { class: 'empty' }, '保存領域を開けませんでした: ' + err.message));
    return;
  }
  grid.append(h('button', { class: 'project-card new', onclick: newProjectDialog },
    h('div', { class: 'card-thumb', html: icon('plus', 48) }), h('div', { class: 'card-name' }, '新規作成')));
  const links = await storage.listLinks().catch(() => ({}));
  for (const p of list) {
    const link = links[p.id];
    const info = () => projectInfoDialog(p, link);
    const card = h('div', { class: 'project-card' },
      h('button', { class: 'card-thumb', onclick: () => openProject(p.id) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'blank' })),
      h('div', { class: 'card-row' },
        h('div', { class: 'card-name' }, p.name),
        link ? h('button', { class: 'card-mark', title: `ファイル「${link.name}」と連動中`, onclick: info }, '🔗') : null,
        h('button', { class: 'card-info', title: '詳細', onclick: info }, 'ⓘ')),
    );
    grid.append(card);
  }
}

/** 作品の詳細と操作(ⓘ・🔗 を押したときに出す) */
async function projectInfoDialog(p, link) {
  const rows = [
    ['ページ数', `${p.pageCount}ページ`],
    ['用紙', p.paperLabel],
    ['最終更新', formatDate(p.updatedAt)],
    ['保存先', link
      ? `ブラウザ内 + ファイル「${link.name}」(🔗 連動中${link.lastWrite ? `・最終書き込み ${formatDate(link.lastWrite)}` : ''})`
      : 'ブラウザ内のみ'],
  ];
  const buttons = [];
  const act = (label, value, extra = {}) => buttons.push({ label, value, ...extra });
  if (linkSupported()) {
    if (link) act('連動を解除', 'unlink');
    else act('ファイルと連動して保存', 'link');
  }
  act('ファイルに書き出す', 'export');
  act('名前変更', 'rename');
  act('削除', 'delete', { danger: true });
  act('開く', 'open', { primary: true });
  const v = await showDialog({
    title: p.name, wide: true,
    body: h('table', { class: 'help-table' }, rows.map(([a, b]) => h('tr', {}, h('th', {}, a), h('td', {}, b)))),
    buttons,
  });
  try {
    if (v === 'open') return openProject(p.id);
    if (v === 'rename') return renameProject(p);
    if (v === 'delete') return removeProject(p);
    if (v === 'export') return exportProjectById(p.id);
    if (v === 'link') {
      const r = await startLink(p.id, p.name);
      toast(r === 'ok' ? 'ファイルと連動しました。編集すると自動で上書きされます' : 'ファイルに書き込めませんでした');
    }
    if (v === 'unlink') { await stopLink(p.id); toast('連動を解除しました(ファイルはそのまま残ります)'); }
  } catch (err) {
    if (err?.name !== 'AbortError') toast('できませんでした: ' + err.message, 4000);
  }
  renderHome();
}

async function openProject(id) {
  // 連動しているファイルへの書き込み許可は、タップした直後のこのタイミングでしか尋ねられない
  if (linkSupported()) {
    const link = await ensureLinkPermission(id);
    if (link?.denied) toast(`ファイル「${link.name}」への書き込みが許可されなかったため、ブラウザ内にだけ保存します`, 4000);
  }
  const json = await storage.getProject(id);
  if (!json) { toast('作品が見つかりません'); return renderHome(); }
  await openEditor(json);
}

async function renameProject(p) {
  const name = await promptDialog('作品名の変更', '作品名', p.name);
  if (!name) return;
  const json = await storage.getProject(p.id);
  json.name = name;
  await storage.putProject(json);
  renderHome();
}

async function removeProject(p) {
  if (!(await confirmDialog('作品の削除', `「${p.name}」を削除します。この操作は取り消せません。`, '削除する', true))) return;
  await storage.deleteProject(p.id);
  renderHome();
}

async function newProjectDialog() {
  const name = h('input', { type: 'text', class: 'input', value: '新しい原稿' });
  const preset = h('select', { class: 'select' }, PRESETS.map((p) => h('option', { value: p.id, selected: p.id === 'b5-doujin' }, p.label)));
  const dpi = h('select', { class: 'select' }, DPI_OPTIONS.map((d) => h('option', { value: d.value, selected: d.value === 200 }, d.label)));
  const cw = h('input', { type: 'number', class: 'input', value: 182, min: 50, max: 600 });
  const ch = h('input', { type: 'number', class: 'input', value: 257, min: 50, max: 900 });
  const pages = h('input', { type: 'number', class: 'input', value: 1, min: 1, max: 200 });
  const tpl = h('select', { class: 'select' }, TEMPLATES.map(([v, l]) => h('option', { value: v, selected: v === '1' }, l)));
  const info = h('p', { class: 'hint' });
  const customRow = h('div', { class: 'field-row' },
    h('label', { class: 'field' }, h('span', {}, '仕上がり幅 (mm)'), cw),
    h('label', { class: 'field' }, h('span', {}, '仕上がり高さ (mm)'), ch));
  const update = () => {
    customRow.style.display = preset.value === 'custom' ? '' : 'none';
    dpi.disabled = preset.value === 'webtoon';
    const paper = buildPaper(preset.value, +dpi.value, { trimW: cw.value, trimH: ch.value });
    const mb = (paper.w * paper.h * 4) / 1024 / 1024;
    info.textContent = `キャンバス: ${paper.w} × ${paper.h} px(1 レイヤーあたり約 ${Math.round(mb)}MB)`;
  };
  for (const el of [preset, dpi, cw, ch]) el.addEventListener('input', update);
  update();
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, '作品名'), name),
    h('label', { class: 'field' }, h('span', {}, '用紙サイズ'), preset),
    customRow,
    h('label', { class: 'field' }, h('span', {}, '解像度'), dpi),
    h('label', { class: 'field' }, h('span', {}, 'ページ数'), pages),
    h('label', { class: 'field' }, h('span', {}, 'コマ枠テンプレート(新しいページにも適用)'), tpl),
    info);
  const ok = await showDialog({
    title: '新規作成', body, wide: true,
    buttons: [{ label: 'キャンセル', value: false }, { label: '作成', value: true, primary: true }],
  });
  if (!ok) return;
  const paper = buildPaper(preset.value, +dpi.value, { trimW: cw.value, trimH: ch.value });
  const project = createProject({ name: name.value.trim() || '無題の原稿', paper, pageCount: Math.min(200, Math.max(1, +pages.value || 1)) });
  project.pageTemplate = tpl.value;
  for (const page of project.pages) applyTemplate(page, paper, tpl.value);
  await storage.putProject(serializeProject(project));
  await openEditor(project);
}

home.querySelector('#btn-new').addEventListener('click', newProjectDialog);
home.querySelector('#btn-help').addEventListener('click', () => editor.ui.showHelp());
home.querySelector('#btn-storage').addEventListener('click', () => showStorageNotice());
showStorageNoticeOnce();

const fileInput = home.querySelector('#file-import');
home.querySelector('#btn-import').addEventListener('click', async () => {
  // 対応ブラウザでは、読み込んだファイルとそのまま連動させる
  if (!linkSupported()) return fileInput.click();
  try {
    await openLinkedFile(importProjectFile);
    toast('読み込みました(ファイルと連動中)');
    renderHome();
  } catch (err) {
    if (err?.name !== 'AbortError') toast('読み込めませんでした: ' + err.message, 5000);
  }
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    toast('読み込み中…', 60000);
    await importProjectFile(file);
    toast('読み込みました');
    renderHome();
  } catch (err) {
    toast('読み込めませんでした: ' + err.message, 5000);
  }
});

// オフラインで使えるように Service Worker を登録(localhost / HTTPS のときのみ有効)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker の登録に失敗', err));
}

storage.requestPersist();
renderHome();

// 開発時のデバッグ用
window.komanote = { editor, storage };
