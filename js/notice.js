// 「データの保存について」の説明

import { h } from './util.js';
import { showDialog } from './dialog.js';
import { linkSupported } from './filelink.js';
import { DRIVE_ENABLED } from './config.js';

const LS_SEEN = 'komanote.storageNoticeSeen.v1';

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
  const supported = linkSupported();
  const status = h('p', { class: 'hint' });
  storageInfo().then((i) => {
    const parts = [];
    if (i.usage != null) parts.push(`ブラウザ内の使用量: ${mb(i.usage)}${i.quota ? ` / 上限の目安 ${mb(i.quota)}` : ''}`);
    if (i.persisted != null) parts.push(i.persisted ? '消されにくい保存: 有効' : '消されにくい保存: 無効');
    status.textContent = parts.join('　');
  });
  return h('div', { class: 'notice-body' },
    h('h4', {}, '自動保存(ブラウザ内)'),
    h('p', {}, '描いた内容は数秒ごとに、この端末のブラウザの中へ自動保存されます。サーバーやクラウドには送られません。'),
    h('p', {}, '次のようなときは消えるので、大切な作品はファイルにも保存してください。'),
    h('ul', {},
      h('li', {}, 'Safari の「履歴と Web サイトデータを消去」をしたとき'),
      h('li', {}, '空き容量が少なくなり、ブラウザが古いデータを削除したとき'),
      h('li', {}, 'ホーム画面に追加せず Safari で使っていて、しばらく(目安 7 日)開かなかったとき'),
      h('li', {}, 'プライベートブラウズで使ったとき、端末の故障・初期化・機種変更')),

    h('h4', {}, 'ファイルと連動して保存 🔗'),
    h('p', {}, '作品をローカルの作品ファイル(.komanote)と結びつけると、編集するたびにそのファイルも自動で上書きされます。'
      + '作品一覧で 🔗 マークが付いている作品が、ファイルと連動している作品です。'),
    h('ul', {},
      h('li', {}, '始め方: 作品一覧で作品の ⓘ →「ファイルと連動して保存」、またはエディタの「ファイル → ファイルと連動して保存」'),
      h('li', {}, '作品ファイルから読み込んだ作品は、そのファイルと自動で連動します'),
      h('li', {}, 'ブラウザを開き直したあとは、作品を開くときに書き込みの許可を聞かれることがあります')),
    h('div', { class: 'notice-box' + (supported ? ' ok' : '') },
      supported
        ? 'この端末のブラウザは「ファイルと連動して保存」に対応しています。'
        : 'この端末のブラウザ(iPad・iPhone の Safari など)は、Web アプリからファイルを自動で上書きする機能に対応していません。'
          + 'そのため 🔗 の連動はできません。作品の ⓘ →「ファイルに書き出す」→「共有・ファイルに保存」で、'
          + '「ファイル」アプリ(iCloud Drive など)に手動で保存してください。'),

    ...(DRIVE_ENABLED ? driveSection() : [h('h4', {}, 'Google ドライブで同期 ☁(準備中)'), h('p', {}, 'Google ドライブとの自動同期は準備中で、まだ使えません。')]),

    h('h4', {}, '作品ファイルから戻す'),
    h('p', {}, '作品一覧の「作品ファイルを読み込む」から .komanote ファイルを選ぶと、作品として読み込まれます。'),
    h('p', { class: 'hint' }, '※ PNG・PDF の書き出しは完成原稿の画像です。続きを描くためのレイヤー・コマ・テキストは作品ファイルにしか残りません。'),
    status,
  );
}

export function showStorageNotice() {
  return showDialog({ title: 'データの保存について', body: storageNoticeBody(), wide: true, buttons: [{ label: '閉じる', value: true, primary: true }] });
}

/** 初めて起動したときに 1 回だけ表示する */
export async function showStorageNoticeOnce() {
  if (localStorage.getItem(LS_SEEN)) return;
  try { localStorage.setItem(LS_SEEN, '1'); } catch { /* 無視 */ }
  await showStorageNotice();
}

// Google ドライブ同期を有効にしたとき(config.js の DRIVE_ENABLED)に表示する説明
function driveSection() {
  return [
    h('h4', {}, 'Google ドライブで同期 ☁'),
    h('p', {}, '作品を Google ドライブの「コマノート」フォルダに保存し、編集するたびに自動で上書きします。iPad でも使えます。'
      + '作品一覧で ☁ マークが付いている作品が、ドライブと同期している作品です。'),
    h('ul', {},
      h('li', {}, '始め方: 作品一覧で作品の ⓘ →「Google ドライブで同期」、またはエディタの「ファイル → Google ドライブで同期」'),
      h('li', {}, '別の端末では、作品一覧の「☁ Google ドライブ」から同じ作品を開けます'),
      h('li', {}, '開くときにドライブの方が新しければ(他の端末で描いた場合など)、ドライブの版を読み込むか選べます'),
      h('li', {}, '他の端末で更新されたファイルは上書きせず、「(競合 日時)」を付けた別名で保存します'),
      h('li', {}, 'ログインの有効期限(約 1 時間)が切れると、右上に「☁ 要ログイン」と出ます。押すとログインし直して保存します'),
      h('li', {}, 'このアプリはドライブ内の、自分で作ったファイルしか読み書きできません(drive.file 権限)'))
  ];
}
