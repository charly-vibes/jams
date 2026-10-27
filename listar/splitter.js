// splitter.js — Listar transcript→items splitter (markers + connectors + quantities)
// Purpose: turn a Whisper transcript into list items, deterministically.
// Responsibilities: phase 1 — explicit markers (numbered "1.", "1)", Spanish
//   ordinals "uno)"…, bullets "- ", "• ", "* ", line breaks, inline sequences);
//   phase 2 — connectors (y, e, comma, luego, después, también, además) split
//   within each segment's content, only when followed by a plausible item start
//   (normative predicate: determiner, quantity token, or non-stopword word —
//   mirrored in the test fixtures); single-item fallback; empty-input handling.
//   phase 3 — quantity parsing (jams-1i9): digits/number words + unit + por-dos/x2
//   per segment; container/count words (docena, paquete, caja) stay as `unit`
//   with their count, never multiplied; dangling quantities fall back to the raw
//   label; duplicate labels with matching unit merge (qty summed). No LLM/API.
// Rationale: deterministic and testable by design (spec §Item Splitter + §Quantity);
//   quantity is a pure post-split transform behind the strategy seam.

// ─── Phase 1: explicit markers ───
// Marker core: number ("1."), Spanish ordinal ("uno)"), bullet ("-", "•", "*")
const MARKER_SRC = '(?:\\d+\\s*[.)]|(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\\s*\\)|[-•*])';
// Leading marker on a line/segment (trailing space optional: bare "1." lines)
const MARKER_RE = new RegExp(`^${MARKER_SRC}\\s*`);
// Marker starting a new segment mid-line (Whisper rarely emits newlines)
const INLINE_MARKER_RE = new RegExp(`(?:^|\\s)${MARKER_SRC}\\s+`, 'g');
// Lookahead split point: whitespace followed by an inline marker
const INLINE_SPLIT_RE = new RegExp(`\\s+(?=${MARKER_SRC}\\s+)`);

// ─── Phase 2: connectors ───
const CONNECTOR_SRC = '(?:y|e|luego|después|despues|también|además)';
// Split points: comma (not between digits — decimal comma) or standalone
// connector word. Whitespace is NOT consumed (lookbehind/lookahead) so that
// "y también" yields two scannable occurrences: "y" fails the predicate
// ("también" is a stopword) and "también" splits instead.
const CONNECTOR_SCAN_RE = new RegExp(
  `(?<!\\d),(?!\\d)|(?<=\\s)${CONNECTOR_SRC}(?=\\s+)`,
  'gi',
);
// Trailing connector/punctuation left behind after an inline marker split
// (connector must be a standalone word — \s+ before, so "leche" keeps its e)
const TRAILING_RE = new RegExp(`\\s+${CONNECTOR_SRC}\\s*$|\\s*[,;:]\\s*$`, 'i');

// Function words that never start an item (normative stopword list)
const STOPWORDS = new Set([
  'de', 'del', 'en', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas',
  'y', 'e', 'o', 'u', 'a', 'al', 'que', 'con', 'por', 'para', 'yo', 'tu', 'te',
  'me', 'se', 'lo', 'le', 'les', 'nos', 'os', 'mi', 'mis', 'su', 'sus', 'si',
  'no', 'ya', 'es', 'son', 'fue', 'va', 'van', 'hay', 'muy', 'pero', 'mas',
  'más', 'esta', 'este', 'esto', 'eso', 'esa', 'esos', 'esas', 'también',
  'tambien', 'además', 'ademas', 'luego', 'después', 'despue', 'ahora',
]);
// Quantity tokens that may start an item ("y 2 litros", "y dos panes")
const QTY_START_RE =
  /^(?:\d+(?:[.,]\d+)?|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|medio|media|docena|par)\b/i;
// Determiners that may start an item ("y el pan")
const DET_START_RE = /^(?:el|la|los|las|un|una|unos|unas)\b/i;

/**
 * Normative predicate (spec §Item Splitter): is the text after a connector the
 * start of a plausible item? — a quantity token, a determiner, or a word of
 * ≥2 letters that is not a function word. Mirrored by the NEG test fixtures.
 */
function plausibleStart(rest) {
  if (!rest) return false;
  rest = rest.trimStart();
  if (QTY_START_RE.test(rest) || DET_START_RE.test(rest)) return true;
  const word = (rest.match(/^[\p{L}]+/u) || [''])[0].toLowerCase();
  return word.length >= 2 && !STOPWORDS.has(word);
}

function stripMarker(segment) {
  return segment.replace(MARKER_RE, '').trim();
}

function countInlineMarkers(line) {
  return (line.match(new RegExp(INLINE_MARKER_RE.source, 'g')) || []).length;
}

/** Split one marker-free segment on connectors that pass the predicate. */
function connectorSplit(text) {
  const points = [];
  for (const m of text.matchAll(CONNECTOR_SCAN_RE)) {
    if (plausibleStart(text.slice(m.index + m[0].length))) {
      points.push(m.index + m[0].length);
    }
  }
  if (points.length === 0) return [text];
  const parts = [];
  let prev = 0;
  for (const p of points) {
    parts.push(text.slice(prev, p));
    prev = p;
  }
  parts.push(text.slice(prev));
  return parts;
}

function toItems(segments) {
  return segments
    .map((s) => {
      // repeated: "leche y también" → strip "también" then "y"
      let prev;
      do {
        prev = s;
        s = s.replace(TRAILING_RE, '').trim();
      } while (s !== prev);
      return s;
    })
    .filter((s) => s.length > 0)
    .map((text) => ({ label: text, text }));
}

// ─── Phase 3: quantity parsing (jams-1i9) ────────────────────────────────

// Spanish number words → numeric value (single-token quantities). Note "par" is
// intentionally NOT here — "un par de" is handled as a compound multiplier (2),
// not a standalone unit, per spec §Quantity ("number words → normalized to digits").
const NUM_WORDS = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, veinte: 20, treinta: 30, cuarenta: 40,
  cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, medio: 0.5, media: 0.5,
};

// Recognized measure/container units. Container/count words (docena, paquete,
// caja) stay as `unit` with their count, never multiplied (spec §Quantity).
// Beyond the spec table with common Spanish shopping-list measures so they are
// treated as units rather than absorbed into the product label.
const UNITS = new Set([
  'litro', 'litros', 'kilo', 'kilos', 'gramo', 'gramos', 'miligramo',
  'miligramos', 'metro', 'metros', 'centimetro', 'centimetros',
  'milimetro', 'milimetros', 'tonelada', 'toneladas', 'libra', 'libras',
  'onza', 'onzas', 'hora', 'horas', 'dia', 'dias', 'día', 'días',
  'documento', 'documentos', 'lata', 'latas', 'botella', 'botellas',
  'caja', 'cajas', 'paquete', 'paquetes', 'bolsa', 'bolsas', 'manojo',
  'mano', 'puñado', 'docena', 'docenas', 'unidad', 'unidades', 'pieza',
  'piezas', 'pza', 'pzas', 'kg', 'g', 'l', 'ml',
]);

/** Parse a single quantity token (digit or Spanish number word) → Number|null. */
function parseQtyToken(tok) {
  tok = tok.toLowerCase();
  if (/^\d+$/.test(tok)) return Number(tok);
  if (/^\d+[,.]\d+$/.test(tok)) return Number(tok.replace(',', '.'));
  const nw = NUM_WORDS[tok];
  return nw !== undefined ? nw : null;
}

/**
 * Skip a leading "de"-group after the unit: `de`, `del`, `de el`, `de la`,
 * `de los`, `de las` (Whisper emits these contractions). Returns the index in
 * `words` where the product begins.
 */
function skipDeGroup(words, startIdx) {
  const w = words[startIdx] ? words[startIdx].toLowerCase() : '';
  if (w === 'del') return startIdx + 1;                          // de + el
  if (w === 'de') {                                            // de + (el|la|los|las)?
    let i = startIdx + 1;
    const a = words[i] ? words[i].toLowerCase() : '';
    if (['el', 'la', 'los', 'las'].includes(a)) i += 1;
    return i;
  }
  return startIdx;
}

/** Compound multiplier "un/una par" → 2 (spec §Quantity: "un par de" → digits). */
function parMultiplier(words, t) {
  if (
    (words[0].toLowerCase() === 'un' || words[0].toLowerCase() === 'una') &&
    words[1] && words[1].toLowerCase() === 'par'
  ) {
    const product = words.slice(skipDeGroup(words, 2)).join(' ').trim();
    if (!product) return { label: t };                       // dangling
    return { label: product, quantity: 2, unit: undefined };
  }
  return null;
}

/** Pattern A: `<qty> <unit> [de-group] <product>`. Dangling if no product. */
function matchQtyUnitProduct(words, qty, t) {
  const unitCand = words[1].toLowerCase();
  if (!UNITS.has(unitCand)) return null;
  const product = words.slice(skipDeGroup(words, 2)).join(' ').trim();
  if (!product) return { label: t };                         // dangling
  return { label: product, quantity: qty, unit: unitCand };
}

/** Pattern C (fallback): `<qty> <product>` — qty + bare product, no unit. */
function matchQtyBareProduct(words, qty, t) {
  const product = words.slice(1).join(' ').trim();
  if (!product) return { label: t };
  return { label: product, quantity: qty, unit: undefined };
}

/**
 * Qty-led matchers (Pattern A/C). Tries the "un par" compound multiplier, then
 * `<qty> <unit> [de-group] <product>`, then `<qty> <product>` (no unit).
 * Returns null when the leading token is not a quantity. The product-multiplier
 * form (Pattern B, e.g. "leche x2") is tried separately in parseQuantity so it
 * only fires when the segment does NOT start with a quantity.
 */
function matchPatternA(t) {
  const words = t.split(/\s+/);
  if (words.length < 2) return null;
  const qty = parseQtyToken(words[0]);
  if (qty === null) return null;
  return parMultiplier(words, t) || matchQtyUnitProduct(words, qty, t) || matchQtyBareProduct(words, qty, t);
}

/** Pattern B: `<product> (por|x) <qty>` — multiplier placed after the product. */
function matchPatternB(t) {
  const m = t.match(/^(.*?)\s+(?:por\s+|x\s*)(\S+)$/i);
  if (!m) return null;
  const product = m[1].trim();
  const qty = parseQtyToken(m[2]);
  if (!product || qty === null) return null;
  return { label: product, quantity: qty, unit: undefined };
}

/**
 * Derive { label, quantity, unit } from one item's raw text. Returns {label}
 * only (no quantity/unit) for dangling quantities; null when no quantity fits.
 */
function parseQuantity(text) {
  const t = text.trim();
  return matchPatternA(t) || matchPatternB(t) || null;
}

/** Apply quantity parsing to every item; preserve the original `text`. */
function parseQuantities(items) {
  return items.map((item) => {
    const parsed = parseQuantity(item.text);
    if (!parsed) return item;
    return { ...item, label: parsed.label, quantity: parsed.quantity, unit: parsed.unit };
  });
}

/** Two items are mergeable: same label (case-insensitive) and same unit (or both undefined). */
function mergeable(a, b) {
  if (a.quantity == null || b.quantity == null) return false;
  return (
    a.label.toLowerCase() === b.label.toLowerCase() &&
    (a.unit || '') === (b.unit || '')
  );
}

/**
 * Merge duplicate items (same label + unit) → qty summed. The merge window is
 * the whole result (not just adjacent items) per spec §Quantity "within a merge
 * window"; mismatched units are kept separate (flagged in the preview UX). The
 * first item's raw `text` is preserved — not rewritten.
 */
function mergeDuplicates(items) {
  const out = [];
  for (const item of items) {
    // last mergeable match wins (non-adjacent duplicates merge too)
    let existing = null;
    for (let i = out.length - 1; i >= 0; i--) {
      if (mergeable(out[i], item)) { existing = out[i]; break; }
    }
    if (existing) {
      existing.quantity = (existing.quantity ?? 0) + (item.quantity ?? 0);
      // keep existing.text (the first raw phrase) — do not rewrite
    } else {
      out.push({ ...item });
    }
  }
  return out;
}

/**
 * Split a transcript into list items.
 * Contract: split(transcript: string) → Array<{ label: string, text: string,
 * quantity?: number, unit?: string }>  (spec §Item Splitter + §Quantity)
 */
export function split(transcript) {
  const lines = String(transcript ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  // Phase 1: multiple lines → each line is a segment; a single line splits on
  // inline marker sequences when there are ≥2 of them; otherwise one segment.
  let segments;
  if (lines.length > 1) {
    segments = lines;
  } else {
    const line = lines[0];
    segments =
      countInlineMarkers(line) >= 2 ? line.split(INLINE_SPLIT_RE) : [line];
  }

  // Phase 2: strip each segment's marker, then connector-split its content.
  // Phase 3: parse quantities, then merge adjacent duplicates.
  return mergeDuplicates(
    parseQuantities(toItems(segments.flatMap((s) => connectorSplit(stripMarker(s))))),
  );
}
