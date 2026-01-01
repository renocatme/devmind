// Minimal IndexedDB wrapper with fallback to localStorage

const DB_NAME = 'project_db_v1';
const STORE_NAME = 'kv_store';

function isBrowser() {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) return reject(new Error('IndexedDB not available'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setItem(key: string, value: string): Promise<void> {
  if (isBrowser()) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      await new Promise((res, rej) => {
        tx.oncomplete = () => res(true);
        tx.onerror = () => rej(tx.error);
      });
      db.close();
      return;
    } catch (e) {
      // fallback
    }
  }
  try { localStorage.setItem(key, value); } catch {}
}

export async function getItem(key: string): Promise<string | null> {
  if (isBrowser()) {
    try {
      const db = await openDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(key);
        req.onsuccess = () => { resolve(req.result ?? null); db.close(); };
        req.onerror = () => { reject(req.error); db.close(); };
      });
    } catch (e) {
      // fallback
    }
  }
  try { return localStorage.getItem(key); } catch { return null; }
}

export async function removeItem(key: string): Promise<void> {
  if (isBrowser()) {
    try {
      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
      await new Promise((res, rej) => { tx.oncomplete = () => res(true); tx.onerror = () => rej(tx.error); });
      db.close();
      return;
    } catch (e) {
      // fallback
    }
  }
  try { localStorage.removeItem(key); } catch {}
}
