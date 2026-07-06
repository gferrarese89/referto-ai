// api.js — chiamate dirette browser → API Claude (Anthropic), con streaming SSE.
// Nessun server intermedio: i dati viaggiano solo tra questo browser e api.anthropic.com.

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export class ApiError extends Error {
  constructor(message, { status = 0, type = '' } = {}) {
    super(message);
    this.status = status;
    this.type = type;
  }
}

function friendlyError(status, body) {
  const type = body?.error?.type || '';
  const detail = body?.error?.message || '';
  switch (status) {
    case 401:
      return new ApiError('Chiave API non valida o revocata. Controllala nelle Impostazioni.', { status, type });
    case 403:
      return new ApiError('La chiave API non ha i permessi necessari (controlla su console.anthropic.com).', { status, type });
    case 429:
      return new ApiError('Troppe richieste o credito esaurito. Attendi qualche secondo e riprova.', { status, type });
    case 529:
      return new ApiError('Il servizio AI è momentaneamente sovraccarico. Riprova tra poco.', { status, type });
    default:
      if (status >= 500) return new ApiError('Errore temporaneo del servizio AI. Riprova tra poco.', { status, type });
      return new ApiError(detail || `Errore nella richiesta (${status}).`, { status, type });
  }
}

/**
 * Invia una richiesta in streaming a Claude.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {Array}  opts.system - blocchi system (con eventuale cache_control)
 * @param {Array}  opts.messages
 * @param {number} [opts.maxTokens]
 * @param {(text: string) => void} [opts.onText] - chiamata per ogni frammento di testo
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{text: string, stopReason: string}>}
 */
export async function streamMessage({ apiKey, model, system, messages, maxTokens = 16000, onText, signal }) {
  if (!apiKey) throw new ApiError('Nessuna chiave API configurata. Vai nelle Impostazioni.', { status: 401 });

  let response;
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        thinking: { type: 'adaptive' },
        system,
        messages,
      }),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Impossibile raggiungere il servizio AI. Controlla la connessione (o eventuali blocchi di rete aziendali).');
  }

  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* corpo non JSON */ }
    throw friendlyError(response.status, body);
  }

  // ---- Parsing dello stream SSE ----
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  let stopReason = '';

  const handleEvent = (dataLine) => {
    let event;
    try { event = JSON.parse(dataLine); } catch { return; }
    if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      fullText += event.delta.text;
      onText?.(event.delta.text);
    } else if (event.type === 'message_delta') {
      if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
    } else if (event.type === 'error') {
      throw friendlyError(0, { error: event.error });
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trimEnd();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) handleEvent(line.slice(5).trim());
    }
  }

  if (stopReason === 'refusal') {
    throw new ApiError('Il modello ha rifiutato la richiesta. Riformula i reperti e riprova.');
  }
  if (stopReason === 'max_tokens') {
    onText?.('\n\n[⚠️ Risposta troncata per limite di lunghezza]');
  }

  return { text: fullText, stopReason };
}
