// 「データの保存について」の説明と、バックアップ日時の記録

import { h } from './util.js';
import { showDialog } from './dialog.js';

const LS_BACKUP = 'komanote.backups.v1';
const LS_SEEN = 'komanote.storageNoticeSeen.v1';

function readBackups() {
  try { return JSON.parse(localStorage.getItem(LS_BACKUP) || '{}'); } catch { return {}; }
}

/** 作品ファイルを書き出した日時を記録する */
export function markBackedUp(projectId) {
  const b = readBackups();
  b[projectId] = Date.now();
  try { localStorage.setItem(LS_BACKUP, JSON.stringify(b)); } catch { /* 無視 */ }
}

export function lastBackup(projectId) {
  return readBackups()[projectId] || null;
}

/** バックアップ後に変更があるか(バックアップしたことがなければ true) */
export function needsBackup(project) {
  const t = lastBackup(project.id);
  return !t || project.updatedAt > t + 5000;
}

/** 端末内の保存領域の状態(わかる範囲で) */
async function storageInfo() {
  const info = { persisted: null, usage: null, quota: null };
  try { info.persisted = await navigator.storage?.persisted?.(); } catch { /* 無視 */ }
  try {
    const e = await navigator.storage?.estimate?.();
    if (e) { info.usage = e.usage; info.quota = e.quota; }
  } catch { /* 無視 */ }
  return info;
}

const mb = (n) => `${(n / 1024 / 1024).toFixed(n > 100 * 1024 * 1024 ? 0 : 1)}MB`;

export function storageNoticeBody() {
  const status = h('p', { class: 'hint' }, '保存領域の状態を確認中…');
  storageInfo().then((i) => {
    const parts = [];
    if (i.usage != null) parts.push(`使用量: ${mb(i.usage)}${i.quota ? ` / 上限の目安 ${mb(i.quota)}` : ''}`);
    if (i.persisted != null) parts.push(i.persisted ? '消されにくい保存(永続化)が有効です' : '消されにくい保存(永続化)は無効です');
    status.textContent = parts.join('　') || '';
  });
  return h('div', { class: 'notice-body' },
    h('div', { class: 'notice-box' },
      h('strong', {}, '作品はこの端末のブラウザの中だけに保存されています。'),
      h('br'), 'サーバーやクラウドには送られません。端末を替えたり、ブラウザのデータが消えたりすると作品も消えます。'),
    h('h4', {}, '作品が消えてしまう主なケース'),
    h('ul', {},
      h('li', {}, 'Safari の設定で「履歴と Web サイトデータを消去」したとき'),
      h('li', {}, 'iPad の空き容量が少なくなり、ブラウザが古いデータを自動で削除したとき'),
      h('li', {}, 'ホーム画面に追加せず Safari で使っていて、しばらく(目安 7 日)開かなかったとき'),
      h('li', {}, 'プライベートブラウズで使ったとき(閉じると消えます)'),
      h('li', {}, 'iPad の故障・初期化・機種変更')),
    h('h4', {}, 'ちゃんと残すには(バックアップ)'),
    h('ol', {},
      h('li', {}, '作品一覧の「バックアップ」、またはエディタの「ファイル → 作品ファイル(.komanote)として保存」を押す'),
      h('li', {}, '「共有・ファイルに保存」から「ファイル」アプリの iCloud Drive や「この iPad 内」に保存する'),
      h('li', {}, '戻すときは作品一覧の「作品ファイルを読み込む」から選ぶ')),
    h('p', {}, '描き進めたら、こまめにバックアップしてください。バックアップ後に変更があった作品には、一覧に「未バックアップ」と表示されます。'),
    h('p', { class: 'hint' }, '※ PNG・PDF の書き出しは完成原稿の画像です。続きを描くためのレイヤーやコマ・テキストの情報は、作品ファイル(.komanote)にしか残りません。'),
    h('p', { class: 'hint' }, '※ ホーム画面に追加して使うと、Safari で開くより消されにくくなります。'),
    status,
  );
}

export function showStorageNotice() {
  return showDialog({ title: 'データの保存について(大切)', body: storageNoticeBody(), wide: true, buttons: [{ label: 'わかった', value: true, primary: true }] });
}

/** 初めて起動したときに 1 回だけ表示する */
export async function showStorageNoticeOnce() {
  if (localStorage.getItem(LS_SEEN)) return;
  await showStorageNotice();
  try { localStorage.setItem(LS_SEEN, '1'); } catch { /* 無視 */ }
}

