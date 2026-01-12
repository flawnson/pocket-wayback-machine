// db.ts (ESM)
const DB_NAME = "personal_wayback_db";
const DB_VERSION = 3;

export const STORES = {
    PAGES: "pages", // key: versionId
    VISITS: "visits", // key: visitId
} as const;

// Page version shape:
// {
//   versionId: string,
//   url: string,
//   urlKey: string,
//   title: string,
//   capturedAt: number,
//   hash: string,
//   contentType: "text/html",
//   html: string
// }

export type ContentType = "text/html";

export interface PageVersion {
    versionId: string;
    url: string;
    urlKey: string;
    title: string;
    capturedAt: number;
    hash: string;
    contentType: ContentType;
    html: string;
}

export interface Visit {
    visitId: string;
    url: string;
    urlKey: string;
    visitAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;

            // pages
            if (!db.objectStoreNames.contains(STORES.PAGES)) {
                const store = db.createObjectStore(STORES.PAGES, { keyPath: "versionId" });
                store.createIndex("by_urlKey", "urlKey", { unique: false });
                store.createIndex("by_url", "url", { unique: false });
                store.createIndex("by_capturedAt", "capturedAt", { unique: false });
            }

            // visits
            if (!db.objectStoreNames.contains(STORES.VISITS)) {
                const v = db.createObjectStore(STORES.VISITS, { keyPath: "visitId" });
                v.createIndex("by_visitAt", "visitAt", { unique: false });
                v.createIndex("by_urlKey", "urlKey", { unique: false });
                v.createIndex("by_url", "url", { unique: false });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
    });

    return dbPromise;
}

export async function putPageVersion(version: PageVersion): Promise<void> {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readwrite");
        tx.objectStore(STORES.PAGES).put(version);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("transaction error"));
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
}

export async function getVersionsByUrlKey(urlKey: string): Promise<PageVersion[]> {
    const db = await openDb();
    return new Promise<PageVersion[]>((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readonly");
        const idx = tx.objectStore(STORES.PAGES).index("by_urlKey");
        const req = idx.getAll(urlKey) as IDBRequest<PageVersion[]>;

        req.onsuccess = () => {
            const all = req.result || [];
            all.sort((a: PageVersion, b: PageVersion) => b.capturedAt - a.capturedAt);
            resolve(all);
        };

        req.onerror = () => reject(req.error ?? new Error("request error"));
    });
}

export async function getVersion(versionId: string): Promise<PageVersion | null> {
    const db = await openDb();
    return new Promise<PageVersion | null>((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readonly");
        const req = tx.objectStore(STORES.PAGES).get(versionId) as IDBRequest<PageVersion | undefined>;

        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error ?? new Error("request error"));
    });
}

export async function deleteVersion(versionId: string): Promise<void> {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readwrite");
        tx.objectStore(STORES.PAGES).delete(versionId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("transaction error"));
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
}

export async function putVisit(visit: Visit): Promise<void> {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.VISITS, "readwrite");
        tx.objectStore(STORES.VISITS).put(visit);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("transaction error"));
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
}

// Delete visits with visitAt < cutoffMs
export async function purgeVisitsOlderThan(cutoffMs: number): Promise<void> {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.VISITS, "readwrite");
        const store = tx.objectStore(STORES.VISITS);
        const idx = store.index("by_visitAt");

        const range = IDBKeyRange.upperBound(cutoffMs, true);
        const cursorReq = idx.openCursor(range);

        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) return;
            cursor.delete();
            cursor.continue();
        };

        cursorReq.onerror = () => reject(cursorReq.error ?? new Error("cursor request error"));

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error("transaction error"));
        tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
    });
}
