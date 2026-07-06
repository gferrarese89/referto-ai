// app.js — bootstrap dell'applicazione e logica della vista principale e delle impostazioni.

import * as storage from './storage.js';
import * as db from './db.js';
import * as sync from './sync.js';
import { streamMessage, ApiError } from './api.js';
import { buildGenerationSystem, buildGenerationMessage, createReportStreamParser } from './prompts.js';
import { initWizard, startWizard } from './wizard.js';
import { showView, toast, applyTheme, copyPlainText, initPasswordToggles } from './ui.js';

// ---------- Stato ----------
let abortController = null;
let lastGeneration = null; // { modality, district } per "Impara da questo"

// ---------- Bootstrap ----------

async function boot() {
  const settings = storage.getSettings();
  applyTheme(settings.theme);
  initPasswordToggles();

  await db.migrateFromLocalStorage(); // migrazione esempi v1 → IndexedDB

  // Banner privacy
  const banner = document.getElementById('privacy-banner');
  banner.hidden = storage.isPrivacyAcknowledged();
  document.getElementById('btn-privacy-ok').addEventListener('click', () => {
    storage.acknowledgePrivacy();
    banner.hidden = true;
  });

  // Tema
  document.getElementById('btn-theme').addEventListener('click', () => {
    const next = storage.getSettings().theme === 'dark' ? 'light' : 'dark';
    storage.saveSettings({ theme: next });
    applyTheme(next);
    sync.schedulePush();
  });

  initWizard({ onFinished: () => { showView('view-main'); } });
  initMainView();
  initSettingsView();

  // Ogni modifica rilevante ai dati → push (usato dal wizard)
  document.addEventListener('refertoai:datachanged', () => sync.schedulePush());

  // Prima apertura → wizard; altrimenti vista principale
  if (!storage.isWizardDone() || !storage.getApiKey()) {
    startWizard();
  } else {
    showView('view-main');
  }

  // Pull all'avvio: se un altro dispositivo ha aggiornato il profilo, lo riceviamo qui.
  sync.pull().then(r => {
    if (r?.changed) toast('Profilo aggiornato dagli altri dispositivi ✓');
  });

  // Service worker (shell offline) — solo su https/localhost
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* non bloccante */ });
  }
}

// ---------- Vista principale ----------

function initMainView() {
  const btnGenerate = document.getElementById('btn-generate');
  const btnStop = document.getElementById('btn-stop');
  const btnClear = document.getElementById('btn-clear');
  const btnCopy = document.getElementById('btn-copy');
  const btnLearn = document.getElementById('btn-learn');
  const statusEl = document.getElementById('gen-status');
  const editor = document.getElementById('report-editor');
  const ddxPanel = document.getElementById('ddx-panel');

  btnGenerate.addEventListener('click', async () => {
    const findings = document.getElementById('inp-findings').value.trim();
    if (!findings) { toast('Scrivi prima i reperti.', { error: true }); return; }
    if (!storage.getApiKey()) { toast('Configura la chiave API nelle Impostazioni.', { error: true }); return; }

    const modality = document.getElementById('sel-modality').value;
    const district = document.getElementById('inp-district').value.trim();
    const clinical = document.getElementById('inp-clinical').value.trim();
    const settings = storage.getSettings();

    const examples = await storage.pickExamples(modality === 'auto' ? '' : modality, district);
    const system = buildGenerationSystem(storage.getStyleProfile(), examples);
    const messages = buildGenerationMessage({ modality, district, clinical, findings });

    editor.value = '';
    ddxPanel.textContent = '';
    ddxPanel.classList.remove('muted');
    statusEl.hidden = false;
    statusEl.classList.remove('error');
    statusEl.textContent = 'Generazione in corso…';
    btnGenerate.disabled = true;
    btnStop.hidden = false;
    abortController = new AbortController();

    const parser = createReportStreamParser({
      onReport: (text) => { editor.value = text; },
      onDdx: (text) => { ddxPanel.textContent = text; },
    });

    try {
      await streamMessage({
        apiKey: storage.getApiKey(),
        model: settings.model,
        system,
        messages,
        maxTokens: 16000,
        signal: abortController.signal,
        onText: (delta) => parser.push(delta),
      });
      parser.finish();
      statusEl.textContent = 'Referto generato ✓ Rileggilo e correggilo prima di copiarlo nel RIS.';
      lastGeneration = { modality: modality === 'auto' ? '' : modality, district };
    } catch (err) {
      if (err.name === 'AbortError') {
        parser.finish();
        statusEl.textContent = 'Generazione interrotta.';
      } else {
        statusEl.classList.add('error');
        statusEl.textContent = '❌ ' + err.message;
        if (err instanceof ApiError && err.status === 401) {
          toast('Chiave API non valida: controllala nelle Impostazioni.', { error: true, ms: 6000 });
        }
      }
    } finally {
      btnGenerate.disabled = false;
      btnStop.hidden = true;
      abortController = null;
    }
  });

  btnStop.addEventListener('click', () => abortController?.abort());

  btnClear.addEventListener('click', () => {
    document.getElementById('inp-findings').value = '';
    document.getElementById('inp-clinical').value = '';
    editor.value = '';
    ddxPanel.textContent = 'Le diagnosi differenziali e i suggerimenti di approfondimento appariranno qui (non vengono copiati nel RIS).';
    ddxPanel.classList.add('muted');
    document.getElementById('gen-status').hidden = true;
  });

  btnCopy.addEventListener('click', async () => {
    const text = editor.value.trim();
    if (!text) { toast('Nessun referto da copiare.', { error: true }); return; }
    const ok = await copyPlainText(text);
    toast(ok ? 'Referto copiato negli appunti ✓ Incollalo nel RIS.' : 'Copia non riuscita: seleziona e copia manualmente.', { error: !ok });
  });

  btnLearn.addEventListener('click', async () => {
    const text = editor.value.trim();
    if (!text) { toast('Nessun referto da salvare come esempio.', { error: true }); return; }
    await storage.addReport({
      modality: lastGeneration?.modality || document.getElementById('sel-modality').value.replace('auto', ''),
      district: lastGeneration?.district || document.getElementById('inp-district').value.trim(),
      title: text.split('\n')[0].slice(0, 60),
      text,
      source: 'manual',
    });
    sync.schedulePush();
    toast('Salvato nel tuo archivio ✓ (i prossimi referti ne terranno conto)');
  });
}

// ---------- Impostazioni ----------

function initSettingsView() {
  const openSettings = async () => {
    const settings = storage.getSettings();
    document.getElementById('set-api-key').value = storage.getApiKey();
    document.getElementById('set-remember-key').checked = settings.rememberKey;
    document.getElementById('set-model').value = settings.model;
    document.getElementById('set-style-profile').value = storage.getStyleProfile();
    document.getElementById('set-gist-token').value = storage.getGistToken();
    document.getElementById('set-sync-enabled').checked = settings.syncEnabled;
    updateSyncStatusLine();
    await renderExamplesList();
    showView('view-settings');
  };

  document.getElementById('btn-settings').addEventListener('click', openSettings);
  document.getElementById('btn-settings-close').addEventListener('click', () => showView('view-main'));

  document.getElementById('btn-save-key').addEventListener('click', () => {
    const key = document.getElementById('set-api-key').value.trim();
    const remember = document.getElementById('set-remember-key').checked;
    storage.setApiKey(key, remember);
    storage.saveSettings({ rememberKey: remember });
    toast(key ? 'Chiave API salvata ✓' : 'Chiave API rimossa.');
  });

  document.getElementById('set-model').addEventListener('change', (e) => {
    storage.saveSettings({ model: e.target.value });
    toast('Modello aggiornato ✓');
  });

  document.getElementById('btn-save-style').addEventListener('click', () => {
    storage.setStyleProfile(document.getElementById('set-style-profile').value.trim());
    sync.schedulePush();
    toast('Profilo di stile salvato ✓');
  });

  document.getElementById('btn-rerun-wizard').addEventListener('click', () => startWizard());

  // --- Sincronizzazione ---
  sync.onSyncStatus((status, detail) => {
    const el = document.getElementById('sync-status');
    el.textContent = detail;
    el.classList.toggle('error', status === 'error');
    if (status === 'ok') updateSyncStatusLine();
  });

  document.getElementById('btn-save-gist-token').addEventListener('click', () => {
    const token = document.getElementById('set-gist-token').value.trim();
    const remember = document.getElementById('set-remember-key').checked; // stessa scelta della chiave API
    storage.setGistToken(token, remember);
    if (token) {
      storage.saveSettings({ syncEnabled: true });
      document.getElementById('set-sync-enabled').checked = true;
      toast('Token salvato ✓ Avvio la prima sincronizzazione…');
      sync.fullSync();
    } else {
      storage.saveSettings({ syncEnabled: false });
      document.getElementById('set-sync-enabled').checked = false;
      toast('Token rimosso: sincronizzazione disattivata.');
    }
  });

  document.getElementById('set-sync-enabled').addEventListener('change', (e) => {
    if (e.target.checked && !storage.getGistToken()) {
      e.target.checked = false;
      toast('Prima inserisci e salva il token GitHub.', { error: true });
      return;
    }
    storage.saveSettings({ syncEnabled: e.target.checked });
    if (e.target.checked) sync.fullSync();
  });

  document.getElementById('btn-sync-now').addEventListener('click', async () => {
    const r = await sync.fullSync();
    if (r?.skipped) toast('Sincronizzazione non configurata: inserisci il token GitHub.', { error: true });
    else if (!r?.error) await renderExamplesList();
  });

  // --- Export / Import ---
  document.getElementById('btn-export').addEventListener('click', async () => {
    const blob = new Blob([await storage.exportProfile()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `refertoai-profilo-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      await storage.importProfile(await file.text());
      toast('Profilo importato ✓');
      document.getElementById('set-style-profile').value = storage.getStyleProfile();
      await renderExamplesList();
      sync.schedulePush();
    } catch (err) {
      toast('Import non riuscito: ' + err.message, { error: true, ms: 6000 });
    } finally {
      e.target.value = '';
    }
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (confirm('Cancellare TUTTI i dati salvati su questo dispositivo (chiave API, token, stile, archivio referti)? L\'operazione non è reversibile e non tocca il Gist remoto.')) {
      await storage.resetAll();
      location.reload();
    }
  });
}

function updateSyncStatusLine() {
  const el = document.getElementById('sync-status');
  const { lastSyncAt, syncEnabled } = storage.getSettings();
  if (!syncEnabled) { el.textContent = 'Sincronizzazione disattivata.'; return; }
  el.textContent = lastSyncAt
    ? `Ultima sincronizzazione: ${new Date(lastSyncAt).toLocaleString('it-IT')}`
    : 'Mai sincronizzato.';
}

async function renderExamplesList() {
  const container = document.getElementById('examples-list');
  const reports = await storage.getReports();
  container.innerHTML = '';
  if (!reports.length) {
    container.innerHTML = '<p class="muted">Archivio vuoto. Usa il wizard o il pulsante "Impara da questo".</p>';
    return;
  }
  const label = document.createElement('p');
  label.className = 'muted';
  label.textContent = `${reports.length} referti in archivio — usati come esempi di stile durante la generazione.`;
  container.append(label);
  reports
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .forEach(e => {
      const div = document.createElement('div');
      div.className = 'example-item';
      const span = document.createElement('span');
      span.textContent = `${e.modality || 'n/d'}${e.district ? ' · ' + e.district : ''} — ${e.title || '(senza titolo)'}`;
      const del = document.createElement('button');
      del.className = 'del-example';
      del.title = 'Elimina dal dispositivo';
      del.textContent = '🗑';
      del.addEventListener('click', async () => {
        await storage.removeReport(e.id);
        sync.schedulePush();
        await renderExamplesList();
      });
      div.append(span, del);
      container.append(div);
    });
}

boot();
