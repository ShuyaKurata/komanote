// 書き出し: PNG / JPEG / PDF / 全ページ ZIP / 作品ファイル(.komanote)の書き出しと読み込み
// 外部ライブラリを使わず、PDF と ZIP は最小限の形式を自前で組み立てる。

import { h, makeCanvas, releaseCanvas, canvasToBlob, downloadBlob, uid } from './util.js';
import { renderPageTo } from './render.js';
import { blobKey } from './model.js';
import * as storage from './storage.js';
import { showDialog, toast } from './dialog.js';
import { buildProjectFile } from './filelink.js';
import { loadFontsFor } from './text.js';

const enc = new TextEncoder();

// ------------------------------------------------------------------
// ページを画像にする
// ------------------------------------------------------------------
/** 開いていないページも一時的に読み込んで処理する */
async function withPage(ed, i, fn) {
  const page = ed.project.pages[i];
  if (i === ed.pageIndex) return fn(page);
  await ed.loadPage(page);
  try { return await fn(page); } finally { ed.unloadPage(page); }
}

/** 出力範囲: canvas=キャンバス全体 / bleed=裁ち落としまで / trim=仕上がりサイズ */
function cropRect(paper, area) {
  if (area === 'trim' && paper.trim) return paper.trim;
  if (area === 'bleed' && paper.bleed) return paper.bleed;
  return { x: 0, y: 0, w: paper.w, h: paper.h };
}

async function renderForExport(ed, page, area) {
  const P = ed.project.paper;
  const full = makeCanvas(P.w, P.h);
  renderPageTo(full, ed.project, page, { includeDraft: false });
  const r = cropRect(P, area);
  const out = makeCanvas(Math.round(r.w), Math.round(r.h));
  const ctx = out.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(full, -Math.round(r.x), -Math.round(r.y));
  releaseCanvas(full);
  return out;
}

// ------------------------------------------------------------------
// PDF(ページごとに JPEG を 1 枚貼る形式)
// ------------------------------------------------------------------
export function buildPdf(pages) {
  const chunks = [];
  let offset = 0;
  const offsets = [];
  const push = (data) => {
    const b = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(b);
    offset += b.length;
  };
  const obj = (n, body) => { offsets[n] = offset; push(`${n} 0 obj\n`); body(); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length;
  const pageIds = pages.map((_, i) => 3 + i * 3);
  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`));
  pages.forEach((p, i) => {
    const pid = pageIds[i], cid = pid + 1, iid = pid + 2;
    const w = p.wPt.toFixed(2), hh = p.hPt.toFixed(2);
    obj(pid, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${hh}] /Resources << /XObject << /Im0 ${iid} 0 R >> >> /Contents ${cid} 0 R >>`));
    const content = `q ${w} 0 0 ${hh} 0 0 cm /Im0 Do Q`;
    obj(cid, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(iid, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.wPx} /Height ${p.hPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
      push(p.jpeg);
      push('\nendstream');
    });
  });
  const xref = offset;
  const total = 3 + n * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  push(x);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// ------------------------------------------------------------------
// ZIP(無圧縮)
// ------------------------------------------------------------------
let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for (const f of files) {
    const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((s, b) => s + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

// ------------------------------------------------------------------
// 書き出しダイアログ
// ------------------------------------------------------------------
const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, '_').trim() || 'manga';

export async function exportDialog(ed) {
  const P = ed.project.paper;
  const sel = (opts, def) => h('select', { class: 'select' }, opts.map(([v, l]) => h('option', { value: v, selected: v === def }, l)));
  const format = sel([['png', 'PNG(画質劣化なし)'], ['jpg', 'JPEG(軽い)'], ['pdf', 'PDF(入稿・印刷向け)']], 'png');
  const range = sel([['current', `このページ(${ed.pageIndex + 1}ページ目)`], ['all', `全ページ(${ed.project.pages.length}ページ)`]], 'current');
  const areaOpts = [['canvas', 'キャンバス全体']];
  if (P.bleed) areaOpts.push(['bleed', '裁ち落としまで(印刷所入稿向け)']);
  if (P.trim) areaOpts.push(['trim', '仕上がりサイズ(Web 公開向け)']);
  const area = sel(areaOpts, P.trim ? 'trim' : 'canvas');
  const body = h('div', { class: 'form' },
    h('label', { class: 'field' }, h('span', {}, '形式'), format),
    h('label', { class: 'field' }, h('span', {}, 'ページ'), range),
    h('label', { class: 'field' }, h('span', {}, '出力範囲'), area),
    h('p', { class: 'hint' }, '下書きレイヤーとガイド線は書き出されません。PNG/JPEG で全ページを選ぶと ZIP にまとめます。'));
  const ok = await showDialog({
    title: '画像・PDF の書き出し', body,
    buttons: [{ label: 'キャンセル', value: false }, { label: '書き出す', value: true, primary: true }],
  });
  if (!ok) return;
  const indices = range.value === 'all' ? ed.project.pages.map((_, i) => i) : [ed.pageIndex];
  ed.busy = true;
  toast('書き出し中…', 60000);
  try {
    await loadFontsFor(indices.flatMap((i) => ed.project.pages[i].items));
    const name = safeName(ed.project.name);
    const fmt = format.value;
    const r = cropRect(P, area.value);
    let file;
    if (fmt === 'pdf') {
      const pages = [];
      for (const i of indices) {
        const c = await withPage(ed, i, (page) => renderForExport(ed, page, area.value));
        const jpeg = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92)).arrayBuffer());
        pages.push({ jpeg, wPx: c.width, hPx: c.height, wPt: (r.w / P.dpi) * 72, hPt: (r.h / P.dpi) * 72 });
        releaseCanvas(c);
      }
      file = new File([buildPdf(pages)], `${name}.pdf`, { type: 'application/pdf' });
    } else {
      const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
      const blobs = [];
      for (const i of indices) {
        const c = await withPage(ed, i, (page) => renderForExport(ed, page, area.value));
        blobs.push({ i, blob: await canvasToBlob(c, mime, 0.92) });
        releaseCanvas(c);
      }
      if (blobs.length === 1) {
        file = new File([blobs[0].blob], `${name}_${String(blobs[0].i + 1).padStart(3, '0')}.${fmt}`, { type: mime });
      } else {
        const files = [];
        for (const b of blobs) files.push({ name: `${name}_${String(b.i + 1).padStart(3, '0')}.${fmt}`, data: new Uint8Array(await b.blob.arrayBuffer()) });
        file = new File([buildZip(files)], `${name}.zip`, { type: 'application/zip' });
      }
    }
    toast('書き出しが完了しました', 1500);
    await deliver(file);
  } catch (err) {
    console.error(err);
    toast('書き出しに失敗しました: ' + err.message, 5000);
  } finally {
    ed.busy = false;
  }
}

/** できたファイルを保存/共有する(iPad では共有シートから「ファイルに保存」や他アプリへ送れる) */
export async function deliver(file) {
  const canShare = navigator.canShare?.({ files: [file] });
  const size = file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(file.size / 1024)}KB`;
  const v = await showDialog({
    title: '書き出し完了',
    body: `${file.name}(${size})`,
    buttons: [
      { label: '閉じる', value: null },
      ...(canShare ? [{ label: '共有・ファイルに保存', value: 'share' }] : []),
      { label: 'ダウンロード', value: 'download', primary: true },
    ],
  });
  if (v === 'download') { downloadBlob(file, file.name); return true; }
  if (v === 'share') {
    try { await navigator.share({ files: [file], title: file.name }); return true; } catch { return false; /* キャンセル */ }
  }
  return false;
}

// ------------------------------------------------------------------
// 作品ファイル(.komanote)
// ------------------------------------------------------------------
export async function exportProjectFile(ed) {
  await ed.save();
  await exportProjectById(ed.project.id);
}

/** 保存済みの作品を作品ファイルにして、ダウンロード/共有で渡す(連動に対応していない端末向けの手動保存) */
export async function exportProjectById(projectId) {
  toast('作品ファイルを作成中…', 60000);
  const file = await buildProjectFile(projectId);
  toast('作成しました', 1200);
  await deliver(file);
}

/** 作品ファイルを読み込んで、新しい作品として保存する。作品 ID を返す */
export async function importProjectFile(file, { replaceId = null } = {}) {
  const data = JSON.parse(await file.text());
  if (data.format !== 'komanote' || !data.project) throw new Error('コマノートの作品ファイルではありません');
  const project = data.project;
  if (replaceId) {
    // 既存の作品を置き換える(ドライブの新しい版を取り込むとき)。古いレイヤー画像は消す
    for (const k of await storage.listBlobKeys(replaceId)) await storage.deleteBlob(k);
    project.id = replaceId;
  } else {
    project.id = uid();
    project.updatedAt = Date.now();
  }
  for (const [layerId, url] of Object.entries(data.layers || {})) {
    const blob = await (await fetch(url)).blob();
    await storage.putBlob(blobKey(project.id, layerId), blob);
  }
  await storage.putProject(project);
  return project.id;
}

// ------------------------------------------------------------------
// 全作品のまとめ書き出し・まとめ読み込み(サイトの引っ越しなど用)
// ------------------------------------------------------------------
/** このアプリが作った無圧縮 ZIP を読む */
export async function readZip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer);
  const dec = new TextDecoder();
  const out = [];
  let p = 0;
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true);
    const size = dv.getUint32(p + 18, true);
    const nameLen = dv.getUint16(p + 26, true), extraLen = dv.getUint16(p + 28, true);
    const name = dec.decode(buf.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extraLen;
    if (method !== 0) throw new Error('圧縮された ZIP には対応していません(コマノートで書き出した ZIP を選んでください)');
    out.push({ name, data: buf.subarray(start, start + size) });
    p = start + size;
  }
  return out;
}

/** すべての作品を作品ファイルにして、1 つの ZIP で渡す */
export async function exportAllProjects() {
  const list = await storage.listProjects();
  if (!list.length) { toast('作品がありません'); return false; }
  const files = [];
  const used = new Set();
  for (let i = 0; i < list.length; i++) {
    toast(`作品ファイルを作成中… (${i + 1}/${list.length})`, 60000);
    const f = await buildProjectFile(list[i].id);
    let name = f.name;
    for (let n = 2; used.has(name); n++) name = f.name.replace(/\.komanote$/, `(${n}).komanote`);
    used.add(name);
    files.push({ name, data: new Uint8Array(await f.arrayBuffer()) });
  }
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  toast('作成しました', 1200);
  return deliver(new File([buildZip(files)], `コマノート_全作品_${stamp}.zip`, { type: 'application/zip' }));
}

/** 作品ファイル(.komanote)と、それをまとめた ZIP を読み込む。読み込んだ作品の数を返す */
export async function importFiles(fileList) {
  let count = 0;
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name)) {
      for (const e of await readZip(file)) {
        if (!e.name.endsWith('.komanote')) continue;
        await importProjectFile(new File([e.data], e.name, { type: 'application/json' }));
        count++;
      }
    } else {
      await importProjectFile(file);
      count++;
    }
  }
  return count;
}
