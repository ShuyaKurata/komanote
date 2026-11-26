// 起動処理と作品一覧(ホーム画面)

import { h, formatDate } from './util.js';
import { icon } from './icons.js';
import { PRESETS, DPI_OPTIONS, buildPaper } from './paper.js';
import { createProject, serializeProject } from './model.js';
import * as storage from './storage.js';
import { Editor } from './editor.js';
import { TEMPLATES, applyTemplate } from './panels.js';
import { showDialog, confirmDialog, promptDialog, toast } from './dialog.js';
import { importProjectFile, exportProjectById, exportAllProjects, importFiles } from './export.js';
import { showStorageNotice, showStorageNoticeOnce } from './notice.js';
import { linkSupported, startLink, stopLink, openLinkedFile, ensureLinkPermission, repairDuplicateLinks, startDriveLink, openDriveFile, driveNewer, pullFromDrive } from './filelink.js';
import * as gdrive from './gdrive.js';
import { driveDialog, ensureDriveAuth, driveNotReady } from './drive-ui.js';
import { DRIVE_ENABLED } from './config.js';

export const APP_VERSION = '1.7.0';

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
let repairedLinks = false;
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
  // 以前のバージョンでできてしまった「1 つのファイルに複数の作品が連動」を直す
  if (!repairedLinks) {
    repairedLinks = true;
    const n = await repairDuplicateLinks().catch(() => 0);
    if (n) toast(`同じファイルに複数の作品が連動していたため、最後に保存した作品だけを連動のままにしました(${n} 件解除)`, 6000);
  }
  const links = await storage.listLinks().catch(() => ({}));
  for (const p of list) {
    const link = links[p.id];
    const info = () => projectInfoDialog(p, link);
    const card = h('div', { class: 'project-card' },
      h('button', { class: 'card-thumb', onclick: () => openProject(p.id) },
        p.thumb ? h('img', { src: p.thumb, alt: '' }) : h('div', { class: 'blank' })),
      h('div', { class: 'card-row' },
        h('div', { class: 'card-name' }, p.name),
        link ? h('button', {
          class: 'card-mark', onclick: info,
          title: link.type === 'drive' ? `Google ドライブ「${link.name}」と同期中` : `ファイル「${link.name}」と連動中`,
        }, link.type === 'drive' ? '☁' : '🔗') : null,
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
    ['保存先', !link ? 'ブラウザ内のみ'
      : link.type === 'drive'
        ? `ブラウザ内 + Google ドライブ「${link.name}」(☁ 同期中${link.lastWrite ? `・最終保存 ${formatDate(link.lastWrite)}` : ''})`
        : `ブラウザ内 + ファイル「${link.name}」(🔗 連動中${link.lastWrite ? `・最終書き込み ${formatDate(link.lastWrite)}` : ''})`],
  ];
  const buttons = [];
  const act = (label, value, extra = {}) => buttons.push({ label, value, ...extra });
  if (link) act(link.type === 'drive' ? '同期を解除' : '連動を解除', 'unlink');
  else {
    act('Google ドライブで同期 ☁', 'drive');
    if (linkSupported()) act('ファイルと連動して保存 🔗', 'link');
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
      const r = await startLink(p.id, p.name, { confirmTakeOver });
      if (r !== 'cancel') toast(r === 'ok' ? 'ファイルと連動しました。編集すると自動で上書きされます' : 'ファイルに書き込めませんでした');
    }
    if (v === 'unlink') { await stopLink(p.id); toast('解除しました(ファイルはそのまま残ります)'); }
    if (v === 'drive' && !DRIVE_ENABLED) await driveNotReady();
    else if (v === 'drive' && await ensureDriveAuth('作品を Google ドライブに保存して、以後は編集するたびに自動で同期します。')) {
      toast('Google ドライブに保存中…', 60000);
      await startDriveLink(p.id);
      toast('Google ドライブに保存しました。以後は自動で同期します');
    }
  } catch (err) {
    if (err?.name !== 'AbortError') toast(err instanceof gdrive.NeedAuth ? 'Google ドライブへの接続が切れました。もう一度お試しください' : 'できませんでした: ' + err.message, 4000);
  }
  renderHome();
}

async function openProject(id) {
  // 連動しているファイルへの書き込み許可は、タップした直後のこのタイミングでしか尋ねられない
  if (linkSupported()) {
    const link = await ensureLinkPermission(id);
    if (link?.denied) toast(`ファイル「${link.name}」への書き込みが許可されなかったため、ブラウザ内にだけ保存します`, 4000);
  }
  await checkDriveNewer(id);
  const json = await storage.getProject(id);
  if (!json) { toast('作品が見つかりません'); return renderHome(); }
  await openEditor(json);
}

/** 選んだファイルが別の作品と連動中のとき、連動先を切り替えてよいか確認する */
export async function confirmTakeOver(otherId) {
  const other = await storage.getProject(otherId);
  return confirmDialog('このファイルは別の作品と連動しています',
    `「${other?.name || '別の作品'}」がこのファイルと連動しています。1 つのファイルに連動できる作品は 1 つだけです。「${other?.name}」の連動を解除して、こちらの作品と連動しますか?(上書きされます)`,
    '切り替える', true);
}

/** ドライブと同期中の作品を開くとき、他の端末で更新されていないか確認する */
async function checkDriveNewer(id) {
  const link = await storage.getLink(id);
  if (!DRIVE_ENABLED || link?.type !== 'drive' || !navigator.onLine) return;
  if (!(await ensureDriveAuth('Google ドライブと同期している作品です。他の端末での変更がないか確認するため、接続します。'))) return;
  try {
    const newer = await driveNewer(id);
    if (!newer) return;
    const v = await showDialog({
      title: 'Google ドライブの方が新しい版です',
      body: `他の端末で ${formatDate(Date.parse(newer.meta.modifiedTime))} に更新されています。ドライブの版を読み込みますか?(この端末の版は置き換わります)`,
      buttons: [{ label: 'この端末の版を使う', value: false }, { label: 'ドライブの版を読み込む', value: true, primary: true }],
    });
    if (v) { toast('ドライブから読み込み中…', 60000); await pullFromDrive(id, importProjectFile); toast('ドライブの版を読み込みました'); }
  } catch (err) {
    toast('Google ドライブを確認できませんでした: ' + err.message, 4000);
  }
}

async function openFromDrive(f) {
  try {
    toast('Google ドライブから読み込み中…', 60000);
    const { id, existed } = await openDriveFile(f, importProjectFile);
    toast(existed ? 'この端末にある同じ作品を開きます' : '読み込みました(☁ 同期中)', 1500);
    await openProject(id);
  } catch (err) {
    toast('開けませんでした: ' + err.message, 5000);
    renderHome();
  }
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
home.querySelector('#btn-drive').addEventListener('click', async () => {
  if (!DRIVE_ENABLED) return driveNotReady();
  await driveDialog(openFromDrive);
  renderHome();
});

if (DRIVE_ENABLED) {
  // Google のログイン画面からページ移動で戻ってきたとき
  const redirected = gdrive.handleRedirect();
  if (redirected === true) toast('Google ドライブに接続しました');
  if (redirected === false) toast('Google ドライブに接続できませんでした');
  gdrive.preloadGis();
}
if (!location.hostname.endsWith('github.io')) showStorageNoticeOnce();

const fileInput = home.querySelector('#file-import');
home.querySelector('#btn-import').addEventListener('click', async () => {
  // 対応ブラウザでは、読み込んだファイルとそのまま連動させる
  if (!linkSupported()) return fileInput.click();
  try {
    const { id, existed, file, zip } = await openLinkedFile(importProjectFile);
    if (zip) return importAndReport([zip]);
    if (!existed) {
      toast('読み込みました(ファイルと連動中)');
      return renderHome();
    }
    // そのファイルとはすでに連動している作品がある: 二重に読み込まず、その作品を使う
    const local = await storage.getProject(id);
    let fileProject = null;
    try { fileProject = JSON.parse(await file.text()).project; } catch { /* 無視 */ }
    if (fileProject && fileProject.updatedAt > (local?.updatedAt || 0) + 1000) {
      const v = await showDialog({
        title: 'すでに連動している作品があります',
        body: `このファイルは作品「${local?.name}」と連動しています。ファイルの方が新しいようです(${formatDate(fileProject.updatedAt)} 更新)。ファイルの内容で作品を置き換えますか?`,
        buttons: [{ label: '作品をそのまま開く', value: 'open' }, { label: 'ファイルの内容で置き換える', value: 'replace', primary: true }],
      });
      if (!v) return renderHome();
      if (v === 'replace') await importProjectFile(file, { replaceId: id });
    } else {
      toast(`このファイルは作品「${local?.name}」と連動済みです。その作品を開きます`, 3000);
    }
    await openProject(id);
  } catch (err) {
    if (err?.name !== 'AbortError') toast('読み込めませんでした: ' + err.message, 5000);
  }
});
async function importAndReport(files) {
  try {
    toast('読み込み中…', 60000);
    const n = await importFiles(files);
    toast(n ? `${n} 個の作品を読み込みました` : '読み込める作品がありませんでした', 3000);
  } catch (err) {
    toast('読み込めませんでした: ' + err.message, 5000);
  }
  renderHome();
}
fileInput.multiple = true;
fileInput.addEventListener('change', () => {
  const files = [...fileInput.files];
  fileInput.value = '';
  if (files.length) importAndReport(files);
});

// ---------------- 旧 URL(GitHub Pages)からの引っ越し案内 ----------------
// 作品はサイトの URL ごとに別々に保存されるので、github.io で描いた作品は komanote.net では見えない。
const NEW_URL = 'https://komanote.net/';
async function showMoveNotice() {
  const has = (await storage.listProjects().catch(() => [])).length > 0;
  const v = await showDialog({
    title: 'コマノートは komanote.net に引っ越しました',
    wide: true,
    body: h('div', { class: 'notice-body' },
      h('p', {}, 'このページ(github.io)は近いうちに終了します。これからは ', h('strong', {}, 'komanote.net'), ' を使ってください。'),
      has ? h('div', { class: 'notice-box' },
        '作品はサイトの URL ごとに別々に保存されているため、ここで描いた作品は komanote.net には自動で引き継がれません。',
        h('br'), '「全作品を書き出す」で ZIP ファイルを保存し、komanote.net の「作品ファイルを読み込む」でその ZIP を選ぶと、まとめて移せます。') : null,
      h('p', { class: 'hint' }, 'ホーム画面に追加している場合は、komanote.net を開いて、もう一度ホーム画面に追加してください。')),
    buttons: [
      { label: 'あとで', value: null },
      ...(has ? [{ label: '全作品を書き出す', value: 'export' }] : []),
      { label: 'komanote.net を開く', value: 'open', primary: true },
    ],
  });
  if (v === 'export') { await exportAllProjects(); showMoveNotice(); }
  if (v === 'open') location.href = NEW_URL;
}
if (location.hostname.endsWith('github.io')) showMoveNotice();

// オフラインで使えるように Service Worker を登録(localhost / HTTPS のときのみ有効)
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker の登録に失敗', err));
}

storage.requestPersist();
renderHome();

// 開発時のデバッグ用
window.komanote = { editor, storage, showMoveNotice };
