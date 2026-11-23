// Google ドライブ同期の画面(接続・設定・ドライブの作品一覧)

import { h, formatDate } from './util.js';
import { showDialog, toast } from './dialog.js';
import * as gdrive from './gdrive.js';

const APP_URL = () => location.origin + location.pathname;

/** Google ドライブ同期がまだ使えないことを知らせる(config.js の DRIVE_ENABLED が false のとき) */
export function driveNotReady() {
  return showDialog({
    title: 'Google ドライブ同期(準備中)',
    body: 'Google ドライブとの同期は、まだ使えません(準備中です)。今は、作品の ⓘ →「ファイルに書き出す」で作品ファイルを保存してください。パソコンの Chrome・Edge なら「ファイルと連動して保存 🔗」も使えます。',
    buttons: [{ label: '閉じる', value: true, primary: true }],
  });
}

/** 初期設定(クライアント ID)の画面。作り方の手順も表示する */
export async function driveSetupDialog() {
  const input = h('input', { type: 'text', class: 'input', placeholder: '123456789-xxxx.apps.googleusercontent.com', value: gdrive.clientId() });
  const body = h('div', { class: 'notice-body' },
    h('p', {}, 'Google ドライブと同期するには、Google Cloud で「OAuth クライアント ID」を 1 つ作り、ここに貼り付けます(無料・最初の 1 回だけ)。'),
    h('ol', {},
      h('li', {}, 'Google Cloud Console(console.cloud.google.com)でプロジェクトを作る'),
      h('li', {}, '「API とサービス → ライブラリ」で「Google Drive API」を有効にする'),
      h('li', {}, '「OAuth 同意画面」を設定する(種類は「外部」。スコープに .../auth/drive.file を追加。テスト中はテストユーザーに自分の Google アカウントを追加)'),
      h('li', {}, '「認証情報 → 認証情報を作成 → OAuth クライアント ID」で種類「ウェブ アプリケーション」を選ぶ'),
      h('li', {}, `「承認済みの JavaScript 生成元」に ${location.origin} 、「承認済みのリダイレクト URI」に ${APP_URL()} を追加`),
      h('li', {}, '作成されたクライアント ID をコピーして、下に貼り付ける')),
    h('label', { class: 'field' }, h('span', {}, 'OAuth クライアント ID'), input),
    h('p', { class: 'hint' }, 'このアプリは drive.file 権限だけを使います。ドライブ内の、このアプリが作ったファイル以外は読み書きできません。'),
  );
  const v = await showDialog({
    title: 'Google ドライブの設定', body, wide: true,
    buttons: [{ label: 'キャンセル', value: false }, { label: '保存', value: true, primary: true }],
  });
  if (!v) return false;
  gdrive.setClientId(input.value);
  gdrive.preloadGis();
  return gdrive.isConfigured();
}

/**
 * ドライブにログイン済みにする。ボタンを押した直後に呼ぶこと。
 * @param beforeRedirect ページ移動でログインする前に呼ばれる(作品の保存など)
 * @returns ログインできたら true
 */
export async function ensureDriveAuth(reason = 'Google ドライブに接続します。', { beforeRedirect } = {}) {
  if (!gdrive.isConfigured() && !(await driveSetupDialog())) return false;
  if (gdrive.hasToken()) return true;
  const v = await showDialog({
    title: 'Google ドライブに接続', body: reason,
    buttons: [{ label: 'あとで', value: false }, { label: '接続する', value: true, primary: true }],
  });
  if (!v) return false;
  try {
    await gdrive.connect({ silent: gdrive.wasConnected() });
    toast('Google ドライブに接続しました');
    return true;
  } catch (err) {
    if (!err.popup) { toast('接続できませんでした: ' + err.message, 4000); return false; }
    // ホーム画面アプリなどでポップアップが開けない場合は、ページを移動してログインする
    const go = await showDialog({
      title: 'ログイン画面を開けませんでした',
      body: 'この環境ではポップアップでログインできないようです。ページを移動して Google にログインしますか?ログイン後はこのアプリに戻ります(作品は保存してから移動します)。',
      buttons: [{ label: 'キャンセル', value: false }, { label: '移動してログイン', value: true, primary: true }],
    });
    if (go) {
      await beforeRedirect?.();
      gdrive.connectByRedirect();
    }
    return false;
  }
}

/**
 * 作品一覧の「Google ドライブ」ボタン: 接続状態と、ドライブにある作品の一覧
 * @param openFile (driveFile) => Promise  ドライブの作品を開く
 */
export async function driveDialog(openFile) {
  if (!gdrive.isConfigured()) {
    if (!(await driveSetupDialog())) return;
  }
  const list = h('div', { class: 'drive-list' }, h('p', { class: 'hint' }, '読み込み中…'));
  const body = h('div', {},
    h('p', { class: 'hint' }, 'ドライブの「コマノート」フォルダにある作品です。開くと、この端末に読み込まれ、以後は編集するとドライブにも自動で保存されます(☁ マーク)。'),
    list);
  let close;
  const p = showDialog({
    title: 'Google ドライブ', body, wide: true,
    buttons: [
      { label: '設定', value: 'setup' },
      ...(gdrive.wasConnected() ? [{ label: '接続を解除', value: 'disconnect' }] : []),
      { label: '閉じる', value: null, primary: true },
    ],
    onOpen: (_box, c) => { close = () => c(null); },
  });
  const renderList = async () => {
    list.innerHTML = '';
    if (!gdrive.hasToken()) {
      list.append(h('div', { class: 'row' },
        h('span', { class: 'hint' }, '接続していません。'),
        h('button', {
          class: 'btn small primary', onclick: async () => {
            try { await gdrive.connect({ silent: gdrive.wasConnected() }); renderList(); } catch (err) {
              close?.();
              if (err.popup) await ensureDriveAuth('ポップアップを開けませんでした。');
              else toast('接続できませんでした: ' + err.message, 4000);
            }
          },
        }, '接続する')));
      return;
    }
    try {
      const files = await gdrive.listFiles();
      if (!files.length) {
        list.append(h('p', { class: 'hint' }, 'まだ作品がありません。作品の ⓘ →「Google ドライブで同期」で保存できます。'));
        return;
      }
      for (const f of files) {
        list.append(h('div', { class: 'drive-row' },
          h('div', { class: 'drive-name' }, f.name.replace(/\.komanote$/, ''),
            h('div', { class: 'hint' }, `${formatDate(Date.parse(f.modifiedTime))}・${Math.ceil((+f.size || 0) / 1024 / 1024 * 10) / 10}MB`)),
          h('button', { class: 'btn small primary', onclick: () => { close?.(); openFile(f); } }, '開く')));
      }
    } catch (err) {
      list.innerHTML = '';
      list.append(h('p', { class: 'hint' }, err instanceof gdrive.NeedAuth ? '接続の有効期限が切れました。' : `読み込めませんでした: ${err.message}`));
      if (err instanceof gdrive.NeedAuth) renderList();
    }
  };
  renderList();
  const v = await p;
  if (v === 'setup') await driveSetupDialog();
  if (v === 'disconnect') { gdrive.disconnect(); toast('Google ドライブとの接続を解除しました(ドライブのファイルは残ります)'); }
}
