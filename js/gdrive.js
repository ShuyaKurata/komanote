// Google ドライブとの同期
//
// - ログインは Google Identity Services(GIS)のトークン方式。サーバーは使わず、ブラウザだけで完結する
// - 権限は drive.file(このアプリが作った・開いたファイルだけを読み書きできる。ドライブの他のファイルは見えない)
// - 作品ファイル(.komanote)をドライブの「コマノート」フォルダに置き、編集したら上書きする
// - 他の端末で更新されていたら上書きせず、別名(競合コピー)で保存する
//
// アクセストークンの有効期限は 1 時間。切れたら、ユーザーがボタンを押したタイミングで取り直す
// (ログイン画面のポップアップは、ボタンを押した直後でないとブラウザに止められるため)。

import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com';
const FOLDER_NAME = 'コマノート';
const LS_CLIENT = 'komanote.gdrive.clientId';
const LS_TOKEN = 'komanote.gdrive.token';
const LS_FOLDER = 'komanote.gdrive.folderId';
const LS_STATE = 'komanote.gdrive.oauthState';

/** ログインが必要なときに投げるエラー */
export class NeedAuth extends Error {
  constructor() { super('Google ドライブへのログインが必要です'); this.name = 'NeedAuth'; }
}

export const clientId = () => localStorage.getItem(LS_CLIENT) || GOOGLE_CLIENT_ID;
export function setClientId(id) {
  if (id) localStorage.setItem(LS_CLIENT, id.trim());
  else localStorage.removeItem(LS_CLIENT);
}
export const isConfigured = () => !!clientId();

function readToken() {
  try {
    const t = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
    return t && t.exp > Date.now() + 60_000 ? t.access : null;
  } catch { return null; }
}
function saveToken(access, expiresIn) {
  localStorage.setItem(LS_TOKEN, JSON.stringify({ access, exp: Date.now() + Number(expiresIn || 3600) * 1000 }));
}
export const hasToken = () => !!readToken();
/** 一度でもログインしたことがあるか(トークンの期限切れは問わない) */
export const wasConnected = () => !!localStorage.getItem(LS_TOKEN);

export function disconnect() {
  const t = readToken();
  if (t && window.google?.accounts?.oauth2?.revoke) window.google.accounts.oauth2.revoke(t, () => {});
  localStorage.removeItem(LS_TOKEN);
  localStorage.removeItem(LS_FOLDER);
}

// ---------------- ログイン ----------------
let gisPromise = null;
/** GIS のスクリプトを読み込む。ボタンを押す前に読み込んでおくと、ポップアップが止められにくい */
export function preloadGis() {
  if (!isConfigured() || !navigator.onLine) return Promise.resolve(false);
  if (window.google?.accounts?.oauth2) return Promise.resolve(true);
  gisPromise ||= new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => { gisPromise = null; resolve(false); };
    document.head.append(s);
  });
  return gisPromise;
}

/**
 * ログイン(ポップアップ)。ボタンを押した直後に呼ぶこと。
 * @param silent 以前に許可していれば、確認画面を出さずにトークンだけ取り直す
 */
export async function connect({ silent = false } = {}) {
  if (!isConfigured()) throw new Error('Google ドライブのクライアント ID が設定されていません');
  if (!(await preloadGis())) throw new Error('Google のログイン画面を読み込めませんでした(オフラインかもしれません)');
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        saveToken(r.access_token, r.expires_in);
        resolve(true);
      },
      error_callback: (e) => reject(Object.assign(new Error(e?.message || e?.type || 'ログインできませんでした'), { popup: true })),
    });
    client.requestAccessToken({ prompt: silent ? '' : 'consent' });
  });
}

/**
 * ポップアップが使えない環境(ホーム画面アプリなど)向け: ページごと Google のログイン画面へ移動する。
 * ログイン後はこのアプリに戻り、handleRedirect() がトークンを受け取る。
 */
export function connectByRedirect() {
  const state = Math.random().toString(36).slice(2);
  localStorage.setItem(LS_STATE, state);
  const redirect = location.origin + location.pathname;
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirect, response_type: 'token', scope: SCOPE,
    include_granted_scopes: 'true', state,
  });
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** リダイレクトで戻ってきたときに、URL のトークンを保存する。受け取ったら true */
export function handleRedirect() {
  if (!location.hash.includes('access_token=') && !location.hash.includes('error=')) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', location.pathname + location.search);
  const ok = p.get('state') && p.get('state') === localStorage.getItem(LS_STATE);
  localStorage.removeItem(LS_STATE);
  if (!ok || p.get('error')) return false;
  saveToken(p.get('access_token'), p.get('expires_in'));
  return true;
}

// ---------------- Drive API ----------------
async function api(path, opts = {}) {
  const t = readToken();
  if (!t) throw new NeedAuth();
  const r = await fetch(path.startsWith('http') ? path : API + path, {
    ...opts,
    headers: { Authorization: `Bearer ${t}`, ...(opts.headers || {}) },
  });
  if (r.status === 401) { localStorage.removeItem(LS_TOKEN); throw new NeedAuth(); }
  if (!r.ok) {
    const err = new Error(`Google ドライブのエラー (${r.status}): ${(await r.text()).slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  return r;
}

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/** 「コマノート」フォルダの ID(無ければ作る) */
async function folderId() {
  const cached = localStorage.getItem(LS_FOLDER);
  if (cached) {
    try {
      const m = await (await api(`/drive/v3/files/${cached}?fields=id,trashed`)).json();
      if (!m.trashed) return cached;
    } catch (e) { if (e instanceof NeedAuth) throw e; }
  }
  const q = `name='${esc(FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const found = await (await api(`/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&spaces=drive`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const created = await (await api('/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    })).json();
    id = created.id;
  }
  localStorage.setItem(LS_FOLDER, id);
  return id;
}

/** ドライブの「コマノート」フォルダにある作品ファイルの一覧 */
export async function listFiles() {
  const folder = await folderId();
  const q = `'${folder}' in parents and trashed=false`;
  const r = await (await api(`/drive/v3/files?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&fields=files(id,name,modifiedTime,size)&pageSize=200`)).json();
  return (r.files || []).filter((f) => f.name.endsWith('.komanote'));
}

/** ファイルの情報。削除されていたら null */
export async function getMeta(fileId) {
  try {
    const m = await (await api(`/drive/v3/files/${fileId}?fields=id,name,modifiedTime,trashed`)).json();
    return m.trashed ? null : m;
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

export async function download(fileId, name = 'drive.komanote') {
  const blob = await (await api(`/drive/v3/files/${fileId}?alt=media`)).blob();
  return new File([blob], name, { type: 'application/json' });
}

/**
 * アップロード(大きなファイルでも失敗しにくい「再開可能アップロード」を使う)
 * @param fileId 指定すると上書き、無ければ新規作成
 * @returns {{id, name, modifiedTime}}
 */
export async function upload(file, { fileId = null, name = file.name } = {}) {
  const meta = fileId ? { name } : { name, parents: [await folderId()], mimeType: 'application/json' };
  const init = await api(
    `/upload/drive/v3/files${fileId ? `/${fileId}` : ''}?uploadType=resumable&fields=id,name,modifiedTime`,
    {
      method: fileId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    },
  );
  const location = init.headers.get('Location');
  if (!location) throw new Error('Google ドライブへのアップロードを開始できませんでした');
  const r = await api(location, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: file });
  return r.json();
}
