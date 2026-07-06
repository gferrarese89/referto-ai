/* RefertoAI — © 2026 Goffredo Ferrarese. Tutti i diritti riservati. Vedi file LICENSE. */
// db.js — archivio referti su IndexedDB (localStorage è troppo piccolo per centinaia di referti).
// Ogni referto: { id, modality, district, title, text, source: 'wizard'|'manual', addedAt, updatedAt }

const DB_NAME = 'refertoai';
const DB_VERSION = 1;
const STORE = 'reports';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('modality', 'modality', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putReport(report) {
  const db = await openDb();
  const now = new Date().toISOString();
  const full = {
    id: report.id || crypto.randomUUID(),
    modality: report.modality || '',
    district: report.district || '',
    title: report.title || '',
    text: report.text || '',
    source: report.source || 'manual',
    addedAt: report.addedAt || now,
    updatedAt: report.updatedAt || now,
  };
  await promisify(tx(db, 'readwrite').put(full));
  return full;
}

export async function putReports(reports) {
  const results = [];
  for (const r of reports) results.push(await putReport(r));
  return results;
}

export async function deleteReport(id) {
  const db = await openDb();
  await promisify(tx(db, 'readwrite').delete(id));
}

export async function getAllReports() {
  const db = await openDb();
  return (await promisify(tx(db, 'readonly').getAll())) || [];
}

export async function getReportsByModality(modality) {
  const db = await openDb();
  return (await promisify(tx(db, 'readonly').index('modality').getAll(modality))) || [];
}

export async function replaceWizardReports(reports) {
  // Sostituisce i referti provenienti dal wizard, conserva quelli 'manual'.
  const all = await getAllReports();
  for (const r of all) {
    if (r.source === 'wizard') await deleteReport(r.id);
  }
  return putReports(reports.map(r => ({ ...r, source: 'wizard' })));
}

export async function clearAllReports() {
  const db = await openDb();
  await promisify(tx(db, 'readwrite').clear());
}

// Migrazione una tantum dei vecchi esempi salvati in localStorage (v1).
export async function migrateFromLocalStorage() {
  const KEY = 'refertoai.examples';
  const raw = localStorage.getItem(KEY);
  if (!raw) return;
  try {
    const examples = JSON.parse(raw);
    if (Array.isArray(examples) && examples.length) {
      await putReports(examples.map(e => ({
        id: e.id,
        modality: e.modality,
        district: e.district,
        title: e.title,
        text: e.text,
        source: e.source || 'wizard',
        addedAt: e.addedAt,
        updatedAt: e.addedAt,
      })));
    }
    localStorage.removeItem(KEY);
  } catch {
    localStorage.removeItem(KEY);
  }
}
