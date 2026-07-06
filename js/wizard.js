// wizard.js — onboarding: chiave API + apprendimento dello stile di refertazione.
// Supporta corpora grandi (analisi a blocchi con consolidamento) e upload .txt/.docx/.doc.

import * as storage from './storage.js';
import { streamMessage } from './api.js';
import {
  buildWizardSystem, buildWizardMessage, parseWizardResponse,
  splitCorpusIntoChunks, buildConsolidationSystem, buildConsolidationMessage, parseConsolidationResponse,
} from './prompts.js';
import { extractTextFromFile } from './extract.js';
import { toast, showView } from './ui.js';

// Prezzi $/milione di token (input, output) per la stima dei costi.
const PRICES = {
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 3, out: 15 },
};

let pendingAnalysis = null; // { styleProfile, examples } in attesa di conferma allo step 3
let analysisState = null;   // stato per riprendere un'analisi interrotta { corpus, chunks, partialProfiles, examples, nextChunk }

function goToStep(n) {
  document.querySelectorAll('.wizard-step').forEach(s => {
    s.hidden = s.dataset.step !== String(n);
  });
}

export function startWizard() {
  const key = storage.getApiKey();
  document.getElementById('wizard-api-key').value = key;
  goToStep(key ? 2 : 1);
  showView('view-wizard');
}

function estimateCostEuro(corpusChars, model) {
  const price = PRICES[model] || PRICES['claude-opus-4-8'];
  const tokens = corpusChars / 3.5; // stima per testo italiano
  // L'analisi ricopia i referti in output (esempi) + profilo: output ≈ input.
  const usd = (tokens * price.in + tokens * 1.1 * price.out) / 1e6;
  return usd * 0.93; // conversione indicativa in €
}

export function initWizard({ onFinished }) {
  // Step 1 → 2: salva chiave
  document.getElementById('wizard-next-1').addEventListener('click', () => {
    const key = document.getElementById('wizard-api-key').value.trim();
    const remember = document.getElementById('wizard-remember-key').checked;
    if (!key) { toast('Inserisci la chiave API per continuare.', { error: true }); return; }
    if (!key.startsWith('sk-ant-')) { toast('La chiave non sembra valida (deve iniziare con "sk-ant-").', { error: true }); return; }
    storage.setApiKey(key, remember);
    storage.saveSettings({ rememberKey: remember });
    goToStep(2);
  });

  // Indietro
  document.querySelectorAll('.wizard-back').forEach(btn => {
    btn.addEventListener('click', () => {
      const current = Number(btn.closest('.wizard-step').dataset.step);
      goToStep(current - 1);
    });
  });

  // Upload file (.txt/.docx/.doc) → testo accodato alla textarea per revisione
  document.getElementById('wizard-file-btn').addEventListener('click', () => {
    document.getElementById('wizard-files').click();
  });
  document.getElementById('wizard-files').addEventListener('change', async (e) => {
    const files = [...e.target.files];
    if (!files.length) return;
    const ta = document.getElementById('wizard-reports');
    let warnings = [];
    for (const file of files) {
      try {
        const { text, warning } = await extractTextFromFile(file);
        if (!text.trim()) { warnings.push(`${file.name}: nessun testo trovato.`); continue; }
        ta.value = (ta.value.trim() ? ta.value.trim() + '\n\n-----\n\n' : '') + text.trim();
        if (warning) warnings.push(`${file.name}: ${warning}`);
      } catch (err) {
        warnings.push(`${file.name}: ${err.message}`);
      }
    }
    updateCorpusInfo();
    toast(warnings.length
      ? warnings.join(' — ')
      : `${files.length} file caricat${files.length === 1 ? 'o' : 'i'} ✓ Controlla il testo e rimuovi eventuali dati identificativi.`,
      { error: warnings.length > 0, ms: warnings.length ? 8000 : 4000 });
    e.target.value = '';
  });

  // Info corpus (dimensione + stima costo) aggiornata mentre si scrive/incolla
  document.getElementById('wizard-reports').addEventListener('input', updateCorpusInfo);

  // Salta: si può refertare anche senza profilo (stile generico)
  document.getElementById('wizard-skip').addEventListener('click', () => {
    storage.setWizardDone();
    onFinished();
  });

  // Analizza stile (con ripresa in caso di blocco fallito)
  document.getElementById('wizard-analyze').addEventListener('click', runAnalysis);

  // Fine wizard: salva tutto
  document.getElementById('wizard-finish').addEventListener('click', async () => {
    const profile = document.getElementById('wizard-style-profile').value.trim();
    storage.setStyleProfile(profile);
    if (pendingAnalysis?.examples?.length) {
      await storage.replaceWizardReports(pendingAnalysis.examples);
    }
    storage.setWizardDone();
    toast('Profilo di stile salvato ✓');
    document.dispatchEvent(new CustomEvent('refertoai:datachanged'));
    onFinished();
  });
}

function updateCorpusInfo() {
  const raw = document.getElementById('wizard-reports').value;
  const info = document.getElementById('wizard-corpus-info');
  if (raw.trim().length < 200) { info.textContent = ''; return; }
  const chunks = splitCorpusIntoChunks(raw);
  const model = storage.getSettings().model;
  const cost = estimateCostEuro(raw.length, model);
  info.textContent =
    `Corpus: ~${Math.round(raw.length / 1000)} k caratteri` +
    (chunks.length > 1 ? `, analisi in ${chunks.length} blocchi` : '') +
    ` — costo stimato una tantum: ~${cost < 0.1 ? '0,1' : cost.toFixed(cost < 1 ? 2 : 1).replace('.', ',')} €`;
}

async function runAnalysis() {
  const raw = document.getElementById('wizard-reports').value.trim();
  if (raw.length < 200) {
    toast('Incolla o carica almeno 2-3 referti completi per un\'analisi utile.', { error: true });
    return;
  }

  const settings = storage.getSettings();
  const progress = document.getElementById('wizard-progress');
  const progressText = document.getElementById('wizard-progress-text');
  const analyzeBtn = document.getElementById('wizard-analyze');

  // Nuova analisi o ripresa di una interrotta?
  if (!analysisState || analysisState.corpus !== raw) {
    const chunks = splitCorpusIntoChunks(raw);
    const cost = estimateCostEuro(raw.length, settings.model);
    if (raw.length > 20000) {
      const ok = confirm(
        `L'analisi elaborerà ~${Math.round(raw.length / 1000)} k caratteri` +
        (chunks.length > 1 ? ` in ${chunks.length} blocchi` : '') +
        `.\nCosto stimato una tantum: ~${cost.toFixed(2).replace('.', ',')} € sulla tua chiave API.\n\nProcedere?`
      );
      if (!ok) return;
    }
    analysisState = { corpus: raw, chunks, partialProfiles: [], examples: [], nextChunk: 0 };
  }

  progress.hidden = false;
  analyzeBtn.disabled = true;

  try {
    const { chunks } = analysisState;

    // 1. Analisi dei blocchi (riparte da dove si era interrotta)
    for (let i = analysisState.nextChunk; i < chunks.length; i++) {
      progressText.textContent = chunks.length > 1
        ? `Analisi blocco ${i + 1} di ${chunks.length}…`
        : 'Analisi dello stile in corso… (può richiedere qualche minuto)';
      let received = 0;
      const { text } = await streamMessage({
        apiKey: storage.getApiKey(),
        model: settings.model,
        system: buildWizardSystem(),
        messages: buildWizardMessage(chunks[i]),
        maxTokens: 32000,
        onText: (d) => {
          received += d.length;
          progressText.textContent =
            (chunks.length > 1 ? `Blocco ${i + 1} di ${chunks.length} — ` : 'Analisi in corso — ') +
            `${Math.round(received / 1000)} k caratteri elaborati`;
        },
      });
      const parsed = parseWizardResponse(text);
      if (!parsed.styleProfile && parsed.examples.length === 0) {
        throw new Error(`Blocco ${i + 1}: risposta in formato inatteso. Premi di nuovo "Analizza" per riprovare da questo blocco.`);
      }
      if (parsed.styleProfile) analysisState.partialProfiles.push(parsed.styleProfile);
      analysisState.examples.push(...parsed.examples);
      analysisState.nextChunk = i + 1;
    }

    // 2. Consolidamento (solo se più profili parziali)
    let styleProfile;
    if (analysisState.partialProfiles.length > 1) {
      progressText.textContent = 'Consolidamento del profilo di stile…';
      const { text } = await streamMessage({
        apiKey: storage.getApiKey(),
        model: settings.model,
        system: buildConsolidationSystem(),
        messages: buildConsolidationMessage(analysisState.partialProfiles),
        maxTokens: 16000,
      });
      styleProfile = parseConsolidationResponse(text);
    } else {
      styleProfile = analysisState.partialProfiles[0] || '';
    }

    pendingAnalysis = { styleProfile, examples: analysisState.examples };
    analysisState = null; // analisi completata

    document.getElementById('wizard-style-profile').value = styleProfile;
    const byModality = {};
    pendingAnalysis.examples.forEach(e => { byModality[e.modality] = (byModality[e.modality] || 0) + 1; });
    document.getElementById('wizard-examples-summary').textContent =
      `Nel tuo archivio: ${pendingAnalysis.examples.length} referti (` +
      Object.entries(byModality).map(([m, n]) => `${m}: ${n}`).join(', ') +
      '). Verranno usati come esempi per le prossime generazioni.';
    goToStep(3);
  } catch (err) {
    if (analysisState && analysisState.nextChunk > 0) {
      toast(`${err.message} — L'analisi riprenderà dal blocco ${analysisState.nextChunk + 1}.`, { error: true, ms: 8000 });
    } else {
      toast(err.message, { error: true, ms: 8000 });
    }
  } finally {
    progress.hidden = true;
    analyzeBtn.disabled = false;
  }
}
