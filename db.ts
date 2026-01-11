// db.js (ESM)
const DB_NAME = "personal_wayback_db";
const DB_VERSION = 3;

const STORES = {
    PAGES: "pages",   // key: versionId
    VISITS: "visits"  // key: visitId
};

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

function openDb() {
    return new Promise((resolve, reject) => {
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
        req.onerror = () => reject(req.error);
    });
}

export async function putPageVersion(version) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readwrite");
        tx.objectStore(STORES.PAGES).put(version);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function getVersionsByUrlKey(urlKey) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readonly");
        const idx = tx.objectStore(STORES.PAGES).index("by_urlKey");
        const req = idx.getAll(urlKey);
        req.onsuccess = () => {
            const all = req.result || [];
            all.sort((a, b) => b.capturedAt - a.capturedAt);
            resolve(all);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function getVersion(versionId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readonly");
        const req = tx.objectStore(STORES.PAGES).get(versionId);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function deleteVersion(versionId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.PAGES, "readwrite");
        tx.objectStore(STORES.PAGES).delete(versionId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

export async function putVisit(visit) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORES.VISITS, "readwrite");
        tx.objectStore(STORES.VISITS).put(visit);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// Delete visits with visitAt < cutoffMs
export async function purgeVisitsOlderThan(cutoffMs) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
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

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}