// extract.js — estrazione del testo da file .txt, .docx e .doc, senza dipendenze esterne.

/**
 * Estrae il testo da un File. Ritorna { text, warning? }.
 */
export async function extractTextFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    const buf = await file.arrayBuffer();
    return { text: await extractDocx(buf) };
  }
  if (name.endsWith('.doc')) {
    const buf = await file.arrayBuffer();
    return {
      text: extractDocLegacy(buf),
      warning: 'Il formato .doc è letto in modo approssimativo: controlla l\'anteprima. Se il testo è illeggibile, salva il file come .docx da Word oppure incolla il testo.',
    };
  }
  // .txt e qualsiasi altro testo semplice
  return { text: await file.text() };
}

// ================= DOCX (ZIP + XML) =================

async function extractDocx(arrayBuffer) {
  const xmlBytes = await readZipEntry(arrayBuffer, 'word/document.xml');
  if (!xmlBytes) throw new Error('File .docx non valido (manca word/document.xml).');
  const xml = new TextDecoder('utf-8').decode(xmlBytes);
  return docxXmlToText(xml);
}

export function docxXmlToText(xml) {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Contenuto .docx non leggibile.');
  const paragraphs = doc.getElementsByTagNameNS(W_NS, 'p');
  const lines = [];
  for (const p of paragraphs) {
    let line = '';
    // w:t = testo, w:tab = tabulazione, w:br = interruzione riga
    const walker = p.getElementsByTagNameNS(W_NS, '*');
    for (const node of walker) {
      if (node.localName === 't') line += node.textContent;
      else if (node.localName === 'tab') line += '\t';
      else if (node.localName === 'br') line += '\n';
    }
    lines.push(line);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// --- Mini lettore ZIP (solo lettura di una entry, store o deflate) ---

export function findZipEntry(bytes, entryName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End Of Central Directory: firma 0x06054b50, cercata dalla fine
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return null;
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true); // inizio central directory

  const decoder = new TextDecoder('utf-8');
  for (let i = 0; i < count; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) return null;
    const method = view.getUint16(offset + 10, true);
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
    if (name === entryName) {
      // Header locale: le lunghezze nome/extra possono differire da quelle della central directory
      if (view.getUint32(localOffset, true) !== 0x04034b50) return null;
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      return { method, data: bytes.subarray(dataStart, dataStart + compSize) };
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function readZipEntry(arrayBuffer, entryName) {
  const bytes = new Uint8Array(arrayBuffer);
  const entry = findZipEntry(bytes, entryName);
  if (!entry) return null;
  if (entry.method === 0) return entry.data; // store
  if (entry.method === 8) { // deflate
    const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error('Metodo di compressione ZIP non supportato.');
}

// ================= DOC legacy (euristico) =================

// Estrae le sequenze di testo leggibile da un .doc binario (OLE).
// Best-effort: il testo nei .doc è tipicamente UTF-16LE o Latin-1.
export function extractDocLegacy(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const isPrintable = (c) =>
    (c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09 ||
    (c >= 0xa0 && c <= 0xff) || c === 0x2019 || c === 0x2018 || c === 0x201c || c === 0x201d || c === 0x2013;

  // Tentativo UTF-16LE: coppie [char, 0x00]
  const runs16 = [];
  let current = '';
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if (isPrintable(code)) {
      current += String.fromCharCode(code);
    } else {
      if (current.trim().length >= 25) runs16.push(current);
      current = '';
    }
  }
  if (current.trim().length >= 25) runs16.push(current);
  const text16 = runs16.join('\n');

  if (text16.length >= 200) return cleanupDocText(text16);

  // Fallback Latin-1 a 8 bit
  const runs8 = [];
  current = '';
  for (let i = 0; i < bytes.length; i++) {
    if (isPrintable(bytes[i])) current += String.fromCharCode(bytes[i]);
    else {
      if (current.trim().length >= 25) runs8.push(current);
      current = '';
    }
  }
  if (current.trim().length >= 25) runs8.push(current);
  return cleanupDocText(runs8.join('\n'));
}

function cleanupDocText(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\x07/g, '\n')          // fine cella tabella nei .doc
    .replace(/[ \t]{3,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
