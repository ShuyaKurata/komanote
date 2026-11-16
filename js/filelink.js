// 端末のファイル(.komanote)との連動
//
// 作品をローカルのファイルに結びつけておき、編集して保存されるたびにそのファイルも上書きする。
// ブラウザの File System Access API(showSaveFilePicker / showOpenFilePicker)を使う。
// 対応: パソコンの Chrome・Edge など。iPad / iPhone の Safari は(2026 年時点では)未対応なので、
// その場合は「ファイルに書き出す」で手動保存する。対応したブラウザでは自動で使えるようになる。

import { blobKey } from './model.js';
import * as storage from './storage.js';

const TYPES = [{ description: 'コマノートの作品ファイル', accept: { 'application/json': ['.komanote'] } }];

export const linkSupported = () => typeof window.showSaveFilePicker === 'function' && typeof window.showOpenFilePicker === 'function';

const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'manga';

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

/** 保存済みの作品から作品ファイルの中身を作る */
export async function buildProjectFile(projectId) {
  const json = await storage.getProject(projectId);
  const layers = {};
  for (const page of json.pages) {
    for (const L of page.layers) {
      const b = await storage.getBlob(blobKey(json.id, L.id));
      if (b) layers[L.id] = await blobToDataUrl(b);
    }
  }
  const data = JSON.stringify({ format: 'komanote', version: 1, exportedAt: Date.now(), project: json, layers });
  return new File([data], `${safeName(json.name)}.komanote`, { type: 'application/json' });
}

async function hasPermission(handle, request) {
  const opts = { mode: 'readwrite' };
  try {
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    if (!request) return false;
    return (await handle.requestPermission(opts)) === 'granted';
  } catch {
    return false;
  }
}

/**
 * 連動しているファイルに書き込む。
 * @param request 書き込み許可が切れていたら尋ねるか(ボタンを押した直後など、ユーザー操作の中でだけ true にできる)
 * @returns 'ok' | 'none'(連動していない) | 'noperm'(許可がない) | 'error'
 */
export async function writeLinked(projectId, { request = false } = {}) {
  const link = await storage.getLink(projectId);
  if (!link) return 'none';
  if (!(await hasPermission(link.handle, request))) return 'noperm';
  try {
    const file = await buildProjectFile(projectId);
    const w = await link.handle.createWritable();
    await w.write(file);
    await w.close();
    await storage.putLink(projectId, { ...link, lastWrite: Date.now() });
    return 'ok';
  } catch (err) {
    console.error(err);
    return 'error';
  }
}

/** 保存先を選んでもらって連動を始め、すぐに 1 回書き込む */
export async function startLink(projectId, suggestedName) {
  const handle = await window.showSaveFilePicker({ suggestedName: `${safeName(suggestedName)}.komanote`, types: TYPES });
  await storage.putLink(projectId, { handle, name: handle.name, lastWrite: 0 });
  return writeLinked(projectId, { request: true });
}

export async function stopLink(projectId) {
  await storage.deleteLink(projectId);
}

/** ファイルを選んで読み込み、そのファイルと連動させる。新しい作品の ID を返す */
export async function openLinkedFile(importProjectFile) {
  const [handle] = await window.showOpenFilePicker({ types: TYPES, multiple: false });
  const id = await importProjectFile(await handle.getFile());
  await storage.putLink(id, { handle, name: handle.name, lastWrite: Date.now() });
  return id;
}

/** 作品を開くとき(ユーザー操作の直後)に、書き込み許可を確認・再取得する */
export async function ensureLinkPermission(projectId) {
  const link = await storage.getLink(projectId);
  if (!link) return null;
  return (await hasPermission(link.handle, true)) ? link : { ...link, denied: true };
}
