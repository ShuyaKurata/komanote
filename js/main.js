// 起動処理と作品一覧(ホーム画面)

import { h, formatDate } from './util.js';
import { icon } from './icons.js';
import { PRESETS, DPI_OPTIONS, buildPaper } from './paper.js';
import { createProject, serializeProject } from './model.js';
import * as storage from './storage.js';
import { Editor } from './editor.js';
import { showDialog, confirmDialog, promptDialog, toast } from './dialog.js';

const home = document.getElementById('home');
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
  for (const p of list) {
    const card = h('div', { class: 'project-card' },
      h('button', { class: 'card-thumb', onclick: () => openProject(p.id) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'blank' })),
      h('div', { class: 'card-name' }, p.name),
      h('div', { class: 'card-meta' }, `${p.pageCount}ページ・${formatDate(p.updatedAt)}`),
      h('div', { class: 'card-meta small' }, p.paperLabel),
      h('div', { class: 'card-actions' },
        h('button', { class: 'btn small', onclick: () => renameProject(p) }, '名前変更'),
        h('button', { class: 'btn small danger', onclick: () => removeProject(p) }, '削除')),
    );
    grid.append(card);
  }
}

async function openProject(id) {
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

/** 新規作成ダイアログで追加の項目を出すための拡張ポイント */
export const newProjectHooks = [];

async function newProjectDialog() {
  const name = h('input', { type: 'text', class: 'input', value: '新しい原稿' });
  const preset = h('select', { class: 'select' }, PRESETS.map((p) => h('option', { value: p.id, selected: p.id === 'b5-doujin' }, p.label)));
  const dpi = h('select', { class: 'select' }, DPI_OPTIONS.map((d) => h('option', { value: d.value, selected: d.value === 200 }, d.label)));
  const cw = h('input', { type: 'number', class: 'input', value: 182, min: 50, max: 600 });
  const ch = h('input', { type: 'number', class: 'input', value: 257, min: 50, max: 900 });
  const pages = h('input', { type: 'number', class: 'input', value: 1, min: 1, max: 200 });
  const info = h('p', { class: 'hint' });
  const customRow = h('div', { class: 'field-row' },
    h('label', { class: 'field' }, h('span', {}, '仕上がり幅 (mm)'), cw),
    h('label', { class: 'field' }, h('span', {}, '仕上がり高さ (mm)'), ch));
  const extras = newProjectHooks.map((hook) => hook.build());
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
    extras.map((x) => x.el),
    info);
  const ok = await showDialog({
    title: '新規作成', body, wide: true,
    buttons: [{ label: 'キャンセル', value: false }, { label: '作成', value: true, primary: true }],
  });
  if (!ok) return;
  const paper = buildPaper(preset.value, +dpi.value, { trimW: cw.value, trimH: ch.value });
  const project = createProject({ name: name.value.trim() || '無題の原稿', paper, pageCount: Math.min(200, Math.max(1, +pages.value || 1)) });
  newProjectHooks.forEach((hook, i) => hook.apply(project, extras[i]));
  await storage.putProject(serializeProject(project));
  await openEditor(project);
}

home.querySelector('#btn-new').addEventListener('click', newProjectDialog);
home.querySelector('#btn-help').addEventListener('click', () => editor.ui.showHelp());

storage.requestPersist();
renderHome();

// 開発時のデバッグ用
window.komanote = { editor, storage };
