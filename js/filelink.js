// 端末のファイル(.komanote)との連動
//
// 作品をローカルのファイルに結びつけておき、編集して保存されるたびにそのファイルも上書きする。
// ブラウザの File System Access API(showSaveFilePicker / showOpenFilePicker)を使う。
// 対応: パソコンの Chrome・Edge など。iPad / iPhone の Safari は(2026 年時点では)未対応なので、
// その場合は「ファイルに書き出す」で手動保存する。対応したブラウザでは自動で使えるようになる。

import { blobKey } from './model.js';
import * as storage from './storage.js';
import * as gdrive from './gdrive.js';

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
 * 連動しているファイル(ローカル or Google ドライブ)に書き込む。
 * @param request 書き込み許可が切れていたら尋ねるか(ボタンを押した直後など、ユーザー操作の中でだけ true にできる)
 * @returns 'ok' | 'none'(連動していない) | 'noperm'(許可がない) | 'needauth'(ドライブへのログインが必要)
 *          | 'conflict'(他の端末で更新されていたので別名で保存した) | 'error'
 */
export async function writeLinked(projectId, { request = false } = {}) {
  const link = await storage.getLink(projectId);
  if (!link) return 'none';
  if (link.type === 'drive') return writeDrive(projectId, link);
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

async function writeDrive(projectId, link) {
  try {
    const file = await buildProjectFile(projectId);
    const meta = await gdrive.getMeta(link.fileId);
    let res, result = 'ok';
    if (!meta) {
      // ドライブ側で削除されていたら作り直す
      res = await gdrive.upload(file);
    } else if (link.remoteModified && meta.modifiedTime !== link.remoteModified) {
      // 他の端末で更新されていた: 上書きせず別名で保存し、以後はそちらと同期する
      const stamp = new Date().toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/[/:\s]/g, '');
      res = await gdrive.upload(file, { name: file.name.replace(/\.komanote$/, `(競合 ${stamp}).komanote`) });
      result = 'conflict';
    } else {
      // ドライブ上の名前(競合コピーの名前など)は保ち、作品名を変えたときだけ名前も変える
      const name = link.uploadedAs && link.uploadedAs === file.name ? link.name : file.name;
      res = await gdrive.upload(file, { fileId: link.fileId, name });
    }
    await storage.putLink(projectId, {
      ...link, fileId: res.id, name: res.name, uploadedAs: file.name, remoteModified: res.modifiedTime, lastWrite: Date.now(),
    });
    return result;
  } catch (err) {
    if (err instanceof gdrive.NeedAuth) return 'needauth';
    console.error(err);
    return 'error';
  }
}

/** Google ドライブとの同期を始める(ドライブに新しくファイルを作る) */
export async function startDriveLink(projectId) {
  const file = await buildProjectFile(projectId);
  const res = await gdrive.upload(file);
  await storage.putLink(projectId, { type: 'drive', fileId: res.id, name: res.name, uploadedAs: file.name, remoteModified: res.modifiedTime, lastWrite: Date.now() });
}

/**
 * ドライブのファイルを開く。同じファイルと同期中の作品が端末にあればその ID を返し、
 * 無ければ読み込んで新しい作品にする。
 */
export async function openDriveFile(f, importProjectFile) {
  const links = await storage.listLinks();
  const existing = Object.entries(links).find(([, l]) => l.type === 'drive' && l.fileId === f.id);
  if (existing) return { id: existing[0], existed: true };
  const file = await gdrive.download(f.id, f.name);
  const id = await importProjectFile(file);
  await storage.putLink(id, { type: 'drive', fileId: f.id, name: f.name, remoteModified: f.modifiedTime, lastWrite: Date.now() });
  return { id, existed: false };
}

/**
 * ドライブ側の方が新しい(他の端末で更新された)か調べる。
 * @returns {null | {meta}} 新しければドライブのファイル情報
 */
export async function driveNewer(projectId) {
  const link = await storage.getLink(projectId);
  if (link?.type !== 'drive') return null;
  const meta = await gdrive.getMeta(link.fileId);
  if (!meta || !link.remoteModified || meta.modifiedTime === link.remoteModified) return null;
  return { meta, link };
}

/** ドライブの版で端末の作品を置き換える */
export async function pullFromDrive(projectId, importProjectFile) {
  const link = await storage.getLink(projectId);
  const meta = await gdrive.getMeta(link.fileId);
  const file = await gdrive.download(link.fileId, meta.name);
  await importProjectFile(file, { replaceId: projectId });
  await storage.putLink(projectId, { ...link, name: meta.name, remoteModified: meta.modifiedTime, lastWrite: Date.now() });
}

/** 保存先を選んでもらって連動を始め、すぐに 1 回書き込む */
/**
 * そのファイルと連動している作品の ID を探す(1 つのファイルには 1 つの作品だけを連動させるため)
 * @param exceptId この作品は除く
 */
export async function findProjectLinkedTo(handle, exceptId = null) {
  const links = await storage.listLinks();
  for (const [id, l] of Object.entries(links)) {
    if (id === exceptId || l.type === 'drive' || !l.handle) continue;
    try { if (await l.handle.isSameEntry(handle)) return id; } catch { /* 無視 */ }
  }
  return null;
}

/**
 * 保存先を選んでもらって連動を始め、すぐに 1 回書き込む。
 * 選んだファイルが別の作品と連動中なら、confirmTakeOver(その作品の ID) で確認し、OK ならそちらの連動を解除する。
 * @returns 'ok' | 'cancel' | writeLinked の結果
 */
export async function startLink(projectId, suggestedName, { confirmTakeOver = async () => false } = {}) {
  const handle = await window.showSaveFilePicker({ suggestedName: `${safeName(suggestedName)}.komanote`, types: TYPES });
  const other = await findProjectLinkedTo(handle, projectId);
  if (other) {
    if (!(await confirmTakeOver(other))) return 'cancel';
    await storage.deleteLink(other);
  }
  await storage.putLink(projectId, { type: 'file', handle, name: handle.name, lastWrite: 0 });
  return writeLinked(projectId, { request: true });
}

export async function stopLink(projectId) {
  await storage.deleteLink(projectId);
}

/**
 * ファイルを選んで読み込み、そのファイルと連動させる。
 * すでにそのファイルと連動している作品があれば、新しく作らずにその作品を返す。
 * @returns {{id, existed, file}} existed=true なら既存の作品(file は選んだファイルの中身。新しさの比較用)
 */
export async function openLinkedFile(importProjectFile) {
  const [handle] = await window.showOpenFilePicker({ types: TYPES, multiple: false });
  const file = await handle.getFile();
  const existing = await findProjectLinkedTo(handle);
  if (existing) return { id: existing, existed: true, file };
  const id = await importProjectFile(file);
  await storage.putLink(id, { type: 'file', handle, name: handle.name, lastWrite: Date.now() });
  return { id, existed: false, file };
}

/**
 * 以前のバージョンで、1 つのファイル(またはドライブのファイル)に複数の作品が連動してしまったものを直す。
 * いちばん最近そのファイルに書き込んだ作品だけ連動を残し、他は解除する。解除した数を返す。
 */
export async function repairDuplicateLinks() {
  const entries = Object.entries(await storage.listLinks());
  const groups = [];
  for (const [id, l] of entries) {
    let g = null;
    for (const grp of groups) {
      const [, l0] = grp[0];
      if (l0.type === 'drive' || l.type === 'drive') {
        if (l0.type === 'drive' && l.type === 'drive' && l0.fileId === l.fileId) g = grp;
      } else {
        try { if (await l0.handle.isSameEntry(l.handle)) g = grp; } catch { /* 無視 */ }
      }
      if (g) break;
    }
    if (g) g.push([id, l]); else groups.push([[id, l]]);
  }
  let removed = 0;
  for (const grp of groups) {
    if (grp.length < 2) continue;
    grp.sort((a, b) => (b[1].lastWrite || 0) - (a[1].lastWrite || 0));
    for (const [id] of grp.slice(1)) { await storage.deleteLink(id); removed++; }
  }
  return removed;
}

/** 作品を開くとき(ユーザー操作の直後)に、書き込み許可を確認・再取得する */
export async function ensureLinkPermission(projectId) {
  const link = await storage.getLink(projectId);
  if (!link || link.type === 'drive') return link || null;
  return (await hasPermission(link.handle, true)) ? link : { ...link, denied: true };
}
