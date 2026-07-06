/* RefertoAI — © 2026 Goffredo Ferrarese. Tutti i diritti riservati. Vedi file LICENSE. */
// prompts.js — costruzione dei prompt per la generazione dei referti e per l'analisi dello stile.

// ---------- System prompt di base (statico → cacheable) ----------

const BASE_SYSTEM = `Sei un medico radiologo senior italiano con vasta esperienza in ecografia, radiologia tradizionale (RX), TC, RM e mammografia. Il tuo compito è redigere referti radiologici completi in italiano a partire dai reperti forniti dal radiologo refertante.

REGOLE FONDAMENTALI:
1. NON inventare mai reperti non riferiti. I reperti patologici descritti dal radiologo sono l'unica fonte di verità sul caso.
2. Integra i reperti patologici riferiti in un referto completo, aggiungendo la descrizione di negatività per le strutture pertinenti all'esame NON menzionate dal radiologo (secondo la prassi della refertazione italiana per quella modalità e quel distretto).
3. Se il radiologo dice "resto negativo", "null'altro" o simili, completa con le formule di negatività appropriate.
4. Correggi refusi e termini stravolti da dettatura vocale interpretandoli nel contesto radiologico (es. "steaduosi epatica" → "steatosi epatica"). Se un termine è irrecuperabilmente ambiguo, segnalalo tra parentesi quadre [?].
5. Normalizza le misure nel formato della refertazione italiana (es. "1 virgola 5 per 2 centimetri" → "15 x 20 mm" oppure "1,5 x 2 cm", coerentemente con lo stile dell'utente).
6. Mantieni coerenza di lateralità (destra/sinistra) e di unità di misura in tutto il referto.
7. Se i reperti riferiti contengono incongruenze cliniche o anatomiche, segnalale nella sezione dei suggerimenti, NON correggerle silenziosamente nel referto.
8. Usa la terminologia radiologica italiana corrente e le classificazioni internazionali quando pertinenti (BI-RADS, LI-RADS, TI-RADS, PI-RADS, Bosniak, Lung-RADS, criteri di Fleischner, ecc.).
9. INTERPRETAZIONE NEL REFERTO: quando i reperti riferiti supportano con ragionevole sicurezza una categoria classificativa o un'ipotesi diagnostica, riportala ANCHE nel testo del referto, tipicamente in conclusione, come da prassi refertativa (es. "cisti renale classificabile come Bosniak II", "reperto compatibile in prima ipotesi con HCC — LI-RADS 5", "quadro deponente per..."). Usa formule prudenziali proporzionate alla certezza ("compatibile con", "da riferire in prima ipotesi a", "meritevole di approfondimento con..."); non inserire nel referto ipotesi speculative o poco supportate — quelle restano solo nella sezione dei suggerimenti.
10. Il referto deve essere pronto per essere copiato in un RIS: solo testo semplice, nessun markdown, nessun asterisco, nessun elenco puntato con simboli speciali (usa trattini semplici se servono elenchi).

FORMATO DELLA RISPOSTA — rispetta ESATTAMENTE questa struttura:
<referto>
[qui il referto completo, nello stile personale dell'utente]
</referto>
<differenziali>
[qui, rivolgendoti al collega radiologo:
- il ragionamento dietro l'interpretazione inserita nel referto (perché quella categoria/ipotesi)
- le diagnosi differenziali alternative in ordine di probabilità, con brevi motivazioni, incluse quelle meno probabili NON inserite nel referto
- eventuali approfondimenti o follow-up raccomandati secondo linee guida
- eventuali incongruenze notate nei reperti riferiti
Se l'esame è del tutto negativo, scrivi solo "Esame negativo, nessuna differenziale da proporre." e gli eventuali suggerimenti pertinenti al quesito clinico.]
</differenziali>`;

// ---------- Costruzione dei blocchi system per la generazione ----------

export function buildGenerationSystem(styleProfile, examples) {
  const blocks = [{ type: 'text', text: BASE_SYSTEM }];

  let personal = '';
  if (styleProfile?.trim()) {
    personal += `STILE PERSONALE DEL RADIOLOGO REFERTANTE — imita fedelmente questo stile (struttura, formule, lessico, lunghezza). Questo stile ha la priorità su qualsiasi convenzione generica:\n\n${styleProfile.trim()}`;
  }
  if (examples?.length) {
    personal += `\n\nESEMPI DI REFERTI SCRITTI DAL RADIOLOGO (riferimento per stile e formule, NON per i contenuti clinici del caso attuale):\n`;
    examples.forEach((e, i) => {
      personal += `\n--- Esempio ${i + 1} (${e.modality || 'n/d'}${e.district ? ', ' + e.district : ''}) ---\n${e.text}\n`;
    });
  }
  if (!personal) {
    personal = `L'utente non ha ancora fornito un profilo di stile. Usa uno stile di refertazione italiana sobrio e discorsivo: titolo esame in maiuscolo, corpo del referto in prosa, conclusioni sintetiche in coda.`;
  }

  blocks.push({
    type: 'text',
    text: personal,
    cache_control: { type: 'ephemeral' },
  });
  return blocks;
}

export function buildGenerationMessage({ modality, district, clinical, findings }) {
  const lines = [];
  if (modality && modality !== 'auto') lines.push(`Modalità: ${modality}`);
  else lines.push(`Modalità: rileva automaticamente dai reperti`);
  if (district) lines.push(`Distretto: ${district}`);
  if (clinical) lines.push(`Quesito clinico / anamnesi: ${clinical}`);
  lines.push('', 'Reperti riferiti dal radiologo:', findings.trim());
  return [{ role: 'user', content: lines.join('\n') }];
}

// ---------- Analisi dello stile (wizard) ----------

const WIZARD_SYSTEM = `Sei un esperto di refertazione radiologica italiana. Ti verranno forniti più referti scritti dallo stesso radiologo, separati da righe di trattini. Il tuo compito:

1. Separa e classifica ogni referto per modalità (Ecografia, RX, TC, RM, Mammografia) e distretto anatomico.
2. Analizza in profondità lo STILE di refertazione del radiologo e producine una descrizione operativa, scritta come istruzioni per imitarlo. Copri: struttura del referto (o assenza di struttura: molti referti italiani sono discorsivi, senza sezioni); come apre e chiude; se e come riporta tecnica e quesito; come descrive i reperti negativi (formule esatte ricorrenti); lessico e formule ricorrenti; formato delle misure (mm vs cm, "x" vs "per"); uso di maiuscole, elenchi, punteggiatura; lunghezza tipica; tono (telegrafico/discorsivo). Cita le formule testuali esatte che usa spesso.
3. Restituisci ogni referto ripulito (senza eventuali dati identificativi residui, che devi omettere) come esempio.

FORMATO DELLA RISPOSTA — rispetta ESATTAMENTE questa struttura:
<profilo_stile>
[descrizione operativa dello stile, in italiano, come elenco di istruzioni]
</profilo_stile>
<esempio modalita="..." distretto="..." titolo="[breve titolo descrittivo]">
[testo integrale del referto]
</esempio>
[un blocco <esempio> per ogni referto fornito]`;

export function buildWizardSystem() {
  return [{ type: 'text', text: WIZARD_SYSTEM }];
}

export function buildWizardMessage(rawReports) {
  return [{
    role: 'user',
    content: `Ecco i miei referti (separati da righe di trattini). Analizza il mio stile:\n\n${rawReports.trim()}`,
  }];
}

// Parser della risposta del wizard.
export function parseWizardResponse(text) {
  const profileMatch = text.match(/<profilo_stile>([\s\S]*?)<\/profilo_stile>/);
  const styleProfile = profileMatch ? profileMatch[1].trim() : '';

  const examples = [];
  const re = /<esempio\s+modalita="([^"]*)"\s+distretto="([^"]*)"\s+titolo="([^"]*)"\s*>([\s\S]*?)<\/esempio>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    examples.push({
      modality: m[1].trim(),
      district: m[2].trim(),
      title: m[3].trim(),
      text: m[4].trim(),
    });
  }
  return { styleProfile, examples };
}

// ---------- Suddivisione del corpus in blocchi (analisi di corpora grandi) ----------

// Divide il corpus in blocchi da ~maxChars senza spezzare un referto:
// i confini preferiti sono le righe di trattini o le doppie righe vuote.
export function splitCorpusIntoChunks(raw, maxChars = 40000) {
  const pieces = raw
    .split(/\n\s*[-—_=]{3,}\s*\n|\n\s*\n\s*\n/)   // separatori: ----- o triple newline
    .map(p => p.trim())
    .filter(Boolean);

  const chunks = [];
  let current = '';
  for (const piece of pieces) {
    if (current && (current.length + piece.length + 10) > maxChars) {
      chunks.push(current);
      current = '';
    }
    // Un singolo "referto" abnormemente lungo (probabile testo non separato):
    // spezzato a forza sul limite.
    if (piece.length > maxChars) {
      if (current) { chunks.push(current); current = ''; }
      for (let i = 0; i < piece.length; i += maxChars) chunks.push(piece.slice(i, i + maxChars));
      continue;
    }
    current += (current ? '\n\n-----\n\n' : '') + piece;
  }
  if (current) chunks.push(current);
  return chunks;
}

// ---------- Consolidamento dei profili parziali (analisi a blocchi) ----------

const CONSOLIDATION_SYSTEM = `Sei un esperto di refertazione radiologica italiana. Ti verranno forniti più profili di stile parziali, ottenuti analizzando blocchi diversi di referti scritti dallo STESSO radiologo. Fondili in un unico profilo di stile coerente e operativo, scritto come istruzioni per imitare quel radiologo. Mantieni tutte le formule testuali esatte ricorrenti citate nei profili parziali (deduplicandole), risolvi eventuali contraddizioni privilegiando le osservazioni più frequenti, e conserva le differenze sistematiche tra modalità se presenti (es. "nelle TC usa..., nelle ecografie usa...").

FORMATO DELLA RISPOSTA:
<profilo_stile>
[il profilo unificato]
</profilo_stile>`;

export function buildConsolidationSystem() {
  return [{ type: 'text', text: CONSOLIDATION_SYSTEM }];
}

export function buildConsolidationMessage(partialProfiles) {
  const parts = partialProfiles.map((p, i) => `--- Profilo parziale ${i + 1} ---\n${p}`);
  return [{ role: 'user', content: `Ecco i profili parziali da fondere:\n\n${parts.join('\n\n')}` }];
}

export function parseConsolidationResponse(text) {
  const m = text.match(/<profilo_stile>([\s\S]*?)<\/profilo_stile>/);
  return m ? m[1].trim() : text.trim();
}

// ---------- Parser incrementale <referto>/<differenziali> per lo streaming ----------

export function createReportStreamParser({ onReport, onDdx }) {
  let buffer = '';

  const extract = (final) => {
    // Referto: da dopo <referto> fino a </referto> (o fine buffer se non ancora chiuso)
    const rOpen = buffer.indexOf('<referto>');
    if (rOpen !== -1) {
      const start = rOpen + '<referto>'.length;
      const rClose = buffer.indexOf('</referto>', start);
      let content;
      if (rClose !== -1) content = buffer.slice(start, rClose);
      else content = trimPartialTag(buffer.slice(start));
      onReport(content.replace(/^\n+/, ''));
    }
    const dOpen = buffer.indexOf('<differenziali>');
    if (dOpen !== -1) {
      const start = dOpen + '<differenziali>'.length;
      const dClose = buffer.indexOf('</differenziali>', start);
      let content;
      if (dClose !== -1) content = buffer.slice(start, dClose);
      else content = trimPartialTag(buffer.slice(start));
      onDdx(content.replace(/^\n+/, ''));
    }
    // Fallback: se il modello non ha usato i delimitatori, mostra tutto come referto.
    if (final && rOpen === -1 && buffer.trim()) onReport(buffer.trim());
  };

  // Evita di mostrare un tag di chiusura parziale (es. "</refer") in coda durante lo streaming.
  const trimPartialTag = (s) => s.replace(/<\/?[a-z]*$/, '');

  return {
    push(delta) { buffer += delta; extract(false); },
    finish() { extract(true); },
  };
}
