// sync.js — sincronizzazione opzionale del profilo tra dispositivi tramite Gist segreto GitHub.
// Cosa viene sincronizzato: profilo di stile, archivio referti (anonimizzati), modello/tema.
// Cosa NON viene MAI sincronizzato: chiave API Claude e token GitHub.

import * as storage from './storage.js';
import * as db from './db.js';

const GIST_API = 'https://api.github.com/gists';
const GIST_DESCRIPTION = 'refertoai-profile (profilo RefertoAI — non modificare a mano)';
const PROFILE_FILE = 'profile.json';
const ARCHIVE_FILE = 'archive.json';

let pushTimer = null;
let statusListener = null;

export function onSyncStatus(fn) { statusListener = fn; }
function notify(status, detail = '') { statusListener?.(status, detail); }

function headers(token) {
  return {
    'Accept': 'application/vnd.github+json',
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function syncConfigured() {
  const s = storage.getSettings();
  return s.syncEnabled && !!storage.getGistToken();
}

// ---------- Individuazione / creazione del gist ----------

async function findOrCreateGist(token) {
  const settings = storage.getSettings();
  if (settings.gistId) return settings.gistId;

  // Cerca tra i propri gist (così un secondo dispositivo si aggancia col solo token)
  const listResp = await fetch(`${GIST_API}?per_page=100`, { headers: headers(token) });
  if (!listResp.ok) throw await gistError(listResp);
  const gists = await listResp.json();
  const existing = gists.find(g => g.description === GIST_DESCRIPTION);
  if (existing) {
    storage.saveSettings({ gistId: existing.id });
    return existing.id;
  }

  // Crea un gist segreto nuovo
  const payload = await buildPayload();
  const createResp = await fetch(GIST_API, {
    method: 'POST',
    headers: headers(token),
    body: JSON.stringify({ description: GIST_DESCRIPTION, public: false, files: payload }),
  });
  if (!createResp.ok) throw await gistError(createResp);
  const created = await createResp.json();
  storage.saveSettings({ gistId: created.id });
  return created.id;
}

async function gistError(resp) {
  if (resp.status === 401) return new Error('Token GitHub non valido o scaduto. Controllalo nelle Impostazioni.');
  if (resp.status === 403) return new Error('Token GitHub senza permesso "gist" (ricrealo selezionando lo scope gist) o limite API raggiunto.');
  if (resp.status === 404) return new Error('Gist non trovato (forse eliminato). Riprova: ne verrà creato uno nuovo.');
  let msg = `Errore GitHub (${resp.status}).`;
  try { msg += ' ' + (await resp.json()).message; } catch { /* senza dettagli */ }
  return new Error(msg);
}

// ---------- Payload locali ----------

async function buildPayload() {
  const profile = {
    styleProfile: storage.getStyleProfile(),
    styleProfileUpdatedAt: storage.getStyleProfileUpdatedAt() || new Date(0).toISOString(),
    settings: storage.sanitizeSettingsForShare(storage.getSettings()),
    settingsUpdatedAt: new Date().toISOString(),
  };
  const archive = { reports: await db.getAllReports() };
  return {
    [PROFILE_FILE]: { content: JSON.stringify(profile, null, 1) },
    [ARCHIVE_FILE]: { content: JSON.stringify(archive, null, 1) },
  };
}

async function readGistFile(gist, name, token) {
  const file = gist.files?.[name];
  if (!file) return null;
  let content = file.content;
  if (file.truncated) {
    const resp = await fetch(file.raw_url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (!resp.ok) return null;
    content = await resp.text();
  }
  try { return JSON.parse(content); } catch { return null; }
}

// ---------- Merge ----------

// Unione dell'archivio per id: vince l'updatedAt più recente; nessuna cancellazione
// remota implicita (un referto eliminato su un device resta sugli altri finché
// non viene eliminato anche lì — scelta prudente per non perdere dati).
export function mergeReports(local, remote) {
  const byId = new Map();
  for (const r of local) byId.set(r.id, r);
  for (const r of remote || []) {
    const cur = byId.get(r.id);
    if (!cur || (r.updatedAt || '') > (cur.updatedAt || '')) byId.set(r.id, r);
  }
  return [...byId.values()];
}

export function pickNewerProfile(localText, localAt, remoteText, remoteAt) {
  if (!remoteText) return { text: localText, at: localAt, changed: false };
  if (!localText) return { text: remoteText, at: remoteAt, changed: true };
  return (remoteAt || '') > (localAt || '')
    ? { text: remoteText, at: remoteAt, changed: true }
    : { text: localText, at: localAt, changed: false };
}

// ---------- Pull / Push ----------

export async function pull() {
  if (!syncConfigured()) return { skipped: true };
  const token = storage.getGistToken();
  notify('syncing', 'Sincronizzazione…');
  try {
    const gistId = await findOrCreateGist(token);
    const resp = await fetch(`${GIST_API}/${gistId}`, { headers: headers(token) });
    if (resp.status === 404) { storage.saveSettings({ gistId: '' }); throw await gistError(resp); }
    if (!resp.ok) throw await gistError(resp);
    const gist = await resp.json();

    const remoteProfile = await readGistFile(gist, PROFILE_FILE, token);
    const remoteArchive = await readGistFile(gist, ARCHIVE_FILE, token);

    let changed = false;

    if (remoteProfile) {
      const merged = pickNewerProfile(
        storage.getStyleProfile(), storage.getStyleProfileUpdatedAt(),
        remoteProfile.styleProfile, remoteProfile.styleProfileUpdatedAt,
      );
      if (merged.changed) {
        storage.setStyleProfile(merged.text, merged.at);
        changed = true;
      }
    }

    if (remoteArchive?.reports) {
      const local = await db.getAllReports();
      const merged = mergeReports(local, remoteArchive.reports);
      if (merged.length !== local.length ||
          merged.some(m => { const l = local.find(x => x.id === m.id); return !l || l.updatedAt !== m.updatedAt; })) {
        await db.putReports(merged);
        changed = true;
      }
      // Se in locale c'è qualcosa che remoto non ha, riallinea il gist.
      if (merged.length !== (remoteArchive.reports || []).length) schedulePush();
    }

    if ((storage.getStyleProfile() || (await db.getAllReports()).length) && changed) {
      storage.setWizardDone();
    }

    storage.saveSettings({ lastSyncAt: new Date().toISOString() });
    notify('ok', 'Sincronizzato ✓');
    return { changed };
  } catch (err) {
    notify('error', err.message);
    return { error: err.message };
  }
}

export async function push() {
  if (!syncConfigured()) return { skipped: true };
  const token = storage.getGistToken();
  notify('syncing', 'Sincronizzazione…');
  try {
    const gistId = await findOrCreateGist(token);
    const resp = await fetch(`${GIST_API}/${gistId}`, {
      method: 'PATCH',
      headers: headers(token),
      body: JSON.stringify({ files: await buildPayload() }),
    });
    if (resp.status === 404) {
      // Gist eliminato: ricrea al prossimo giro
      storage.saveSettings({ gistId: '' });
      throw await gistError(resp);
    }
    if (!resp.ok) throw await gistError(resp);
    storage.saveSettings({ lastSyncAt: new Date().toISOString() });
    notify('ok', 'Sincronizzato ✓');
    return { ok: true };
  } catch (err) {
    notify('error', err.message);
    return { error: err.message };
  }
}

// Push automatico con debounce, chiamato dopo ogni modifica rilevante.
export function schedulePush(delayMs = 5000) {
  if (!syncConfigured()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { push(); }, delayMs);
}

// Sync completa (pull con merge, poi push): usata all'avvio e dal pulsante manuale.
export async function fullSync() {
  const r = await pull();
  if (r.error || r.skipped) return r;
  return push();
}
