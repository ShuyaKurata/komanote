// IndexedDB への保存
// - projects ストア: 作品の JSON(レイヤーの画素以外)
// - blobs ストア   : "作品ID/レイヤーID" → PNG Blob
// - links ストア   : 作品ID → 連動しているローカルファイル { handle, name, lastWrite }

const DB_NAME = 'komanote';
const DB_VERSION = 2;
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('links')) db.createObjectStore('links');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbPromise;
}

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function listProjects() {
  const all = await req((await store('projects')).getAll());
  return all
    .map((p) => ({
      id: p.id, name: p.name, updatedAt: p.updatedAt, pageCount: p.pages.length,
      paperLabel: p.paper.label, thumb: p.pages[0]?.thumb || null,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id) {
  return req((await store('projects')).get(id));
}

export async function putProject(json) {
  return req((await store('projects', 'readwrite')).put(json));
}

export async function deleteProject(id) {
  await req((await store('projects', 'readwrite')).delete(id));
  await deleteLink(id);
  for (const key of await listBlobKeys(id)) await deleteBlob(key);
}

export async function getBlob(key) {
  return req((await store('blobs')).get(key));
}

export async function putBlob(key, blob) {
  return req((await store('blobs', 'readwrite')).put(blob, key));
}

export async function deleteBlob(key) {
  return req((await store('blobs', 'readwrite')).delete(key));
}

export async function copyBlob(fromKey, toKey) {
  const b = await getBlob(fromKey);
  if (b) await putBlob(toKey, b);
}

export async function listBlobKeys(projectId) {
  const range = IDBKeyRange.bound(`${projectId}/`, `${projectId}/￿`);
  return req((await store('blobs')).getAllKeys(range));
}

/** ストレージを消されにくくする(Safari ではホーム画面追加時に効果がある) */
export async function requestPersist() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch { /* 無視 */ }
}

// ---- ローカルファイルとの連動情報 ----
export async function getLink(projectId) {
  return req((await store('links')).get(projectId));
}
export async function putLink(projectId, link) {
  return req((await store('links', 'readwrite')).put(link, projectId));
}
export async function deleteLink(projectId) {
  return req((await store('links', 'readwrite')).delete(projectId));
}
export async function listLinks() {
  const s = await store('links');
  const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
}
