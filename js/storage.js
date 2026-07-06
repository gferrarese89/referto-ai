/* RefertoAI — © 2026 Goffredo Ferrarese. Tutti i diritti riservati. Vedi file LICENSE. */
// storage.js — persistenza locale (localStorage/sessionStorage per dati piccoli,
// IndexedDB via db.js per l'archivio referti) e export/import del profilo.
// Nessun dato lascia il dispositivo tranne le chiamate all'API Claude e, se attivata, la sync su Gist.

import * as db from './db.js';

const KEYS = {
  apiKey: 'refertoai.apiKey',
  gistToken: 'refertoai.gistToken',
  settings: 'refertoai.settings',
  styleProfile: 'refertoai.styleProfile',
  styleProfileUpdatedAt: 'refertoai.styleProfileUpdatedAt',
  privacyAck: 'refertoai.privacyAck',
  wizardDone: 'refertoai.wizardDone',
};

const DEFAULT_SETTINGS = {
  model: 'claude-opus-4-8',
  theme: 'light',
  rememberKey: true,
  syncEnabled: false,
  gistId: '',
  lastSyncAt: '',
};

// ---------- Segreti (chiave API Claude, token GitHub) ----------
// Se "ricorda" è attivo → localStorage; altrimenti sessionStorage (sparisce alla chiusura).

function getSecret(key) {
  return localStorage.getItem(key) || sessionStorage.getItem(key) || '';
}
function setSecret(key, value, remember) {
  localStorage.removeItem(key);
  sessionStorage.removeItem(key);
  if (!value) return;
  (remember ? localStorage : sessionStorage).setItem(key, value);
}

export function getApiKey() { return getSecret(KEYS.apiKey); }
export function setApiKey(key, remember) { setSecret(KEYS.apiKey, key, remember); }

export function getGistToken() { return getSecret(KEYS.gistToken); }
export function setGistToken(token, remember) { setSecret(KEYS.gistToken, token, remember); }

// ---------- Impostazioni ----------

export function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEYS.settings) || '{}') };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch) {
  const merged = { ...getSettings(), ...patch };
  localStorage.setItem(KEYS.settings, JSON.stringify(merged));
  return merged;
}

// ---------- Profilo di stile ----------

export function getStyleProfile() {
  return localStorage.getItem(KEYS.styleProfile) || '';
}

export function getStyleProfileUpdatedAt() {
  return localStorage.getItem(KEYS.styleProfileUpdatedAt) || '';
}

export function setStyleProfile(text, updatedAt) {
  localStorage.setItem(KEYS.styleProfile, text || '');
  localStorage.setItem(KEYS.styleProfileUpdatedAt, updatedAt || new Date().toISOString());
}

// ---------- Archivio referti (delegato a IndexedDB) ----------

export const getReports = db.getAllReports;
export const addReport = db.putReport;
export const removeReport = db.deleteReport;
export const replaceWizardReports = db.replaceWizardReports;

// Seleziona fino a `max` referti pertinenti come esempi few-shot.
// Priorità: stessa modalità+distretto > stessa modalità; a parità, 'manual'
// (corretti a mano dall'utente = più fedeli) e più recenti prima.
export async function pickExamples(modality, district, max = 3) {
  const all = await db.getAllReports();
  const norm = s => (s || '').toLowerCase().trim();
  const m = norm(modality), d = norm(district);

  const score = (r) => {
    let s = 0;
    if (m && norm(r.modality) === m) s += 100;
    if (d && (norm(r.district).includes(d) || d.includes(norm(r.district)) && r.district)) s += 50;
    if (r.source === 'manual') s += 10;
    return s;
  };
  const sorted = all
    .map(r => ({ r, s: score(r) }))
    .sort((a, b) => b.s - a.s || (b.r.updatedAt || '').localeCompare(a.r.updatedAt || ''));

  // Se c'è una modalità richiesta e nessun referto la matcha, meglio comunque
  // 1 esempio generico che zero (dà il tono).
  const picked = sorted.filter(x => !m || x.s >= 100).slice(0, max).map(x => x.r);
  if (picked.length === 0 && sorted.length > 0) picked.push(sorted[0].r);
  return picked;
}

// ---------- Flag vari ----------

export function isPrivacyAcknowledged() { return localStorage.getItem(KEYS.privacyAck) === '1'; }
export function acknowledgePrivacy() { localStorage.setItem(KEYS.privacyAck, '1'); }

export function isWizardDone() { return localStorage.getItem(KEYS.wizardDone) === '1'; }
export function setWizardDone() { localStorage.setItem(KEYS.wizardDone, '1'); }

// ---------- Export / Import profilo ----------

export async function exportProfile({ includeApiKey = false } = {}) {
  const data = {
    app: 'RefertoAI',
    version: 2,
    exportedAt: new Date().toISOString(),
    styleProfile: getStyleProfile(),
    styleProfileUpdatedAt: getStyleProfileUpdatedAt(),
    reports: await db.getAllReports(),
    settings: sanitizeSettingsForShare(getSettings()),
  };
  if (includeApiKey) data.apiKey = getApiKey();
  return JSON.stringify(data, null, 2);
}

export async function importProfile(jsonText) {
  const data = JSON.parse(jsonText);
  if (data.app !== 'RefertoAI') throw new Error('Il file non è un profilo RefertoAI valido.');
  if (typeof data.styleProfile === 'string') setStyleProfile(data.styleProfile, data.styleProfileUpdatedAt);
  const reports = data.reports || data.examples; // v2 || v1
  if (Array.isArray(reports) && reports.length) await db.putReports(reports);
  if (data.settings && typeof data.settings === 'object') saveSettings(sanitizeSettingsForShare(data.settings));
  if (data.apiKey) setApiKey(data.apiKey, true);
  if (data.styleProfile || (reports || []).length) setWizardDone();
  return data;
}

// Le impostazioni condivise tra dispositivi non devono trascinarsi dietro
// riferimenti specifici del dispositivo di origine.
export function sanitizeSettingsForShare(settings) {
  const { model, theme } = { ...DEFAULT_SETTINGS, ...settings };
  return { model, theme };
}

export async function resetAll() {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k));
  sessionStorage.removeItem(KEYS.apiKey);
  sessionStorage.removeItem(KEYS.gistToken);
  await db.clearAllReports();
}
