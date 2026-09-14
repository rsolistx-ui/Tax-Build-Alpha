const DB_NAME = "folio-offline";
const STORE = "queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { autoIncrement: true }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueReceipt(clientId: string, file: File): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).add({ clientId, name: file.name, type: file.type, blob: file, createdAt: Date.now() });
}

export async function drainQueue(upload: (clientId: string, file: File) => Promise<void>): Promise<number> {
  const db = await openDb();
  const items: Array<{ key: IDBValidKey; value: any }> = await new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    const keysReq = tx.objectStore(STORE).getAllKeys();
    tx.oncomplete = () => resolve((keysReq.result as IDBValidKey[]).map((k, i) => ({ key: k, value: (req.result as any[])[i] })));
  });
  let done = 0;
  for (const { key, value } of items) {
    try {
      const file = value.blob instanceof File ? value.blob : new File([value.blob], value.name, { type: value.type });
      await upload(value.clientId, file);
      const tx2 = db.transaction(STORE, "readwrite");
      tx2.objectStore(STORE).delete(key);
      await new Promise<void>((r) => (tx2.oncomplete = () => r()));
      done++;
    } catch { break; }
  }
  return done;
}

export function registerSyncListener(upload: (clientId: string, file: File) => Promise<void>): () => void {
  const onlineHandler = () => void drainQueue(upload);
  window.addEventListener("online", onlineHandler);
  let swHandler: ((e: MessageEvent) => void) | null = null;
  if ("serviceWorker" in navigator) {
    swHandler = (e) => {
      if (e.data?.type === "folio-sync") void drainQueue(upload);
    };
    navigator.serviceWorker.addEventListener("message", swHandler);
  }
  return () => {
    window.removeEventListener("online", onlineHandler);
    if (swHandler && "serviceWorker" in navigator) {
      navigator.serviceWorker.removeEventListener("message", swHandler);
    }
  };
}

export async function queueCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => resolve(req.result);
  });
}
