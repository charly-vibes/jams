// splitter.js — Listar transcript→items splitter (markers + connectors)
// Purpose: turn a Whisper transcript into list items, deterministically.
// Responsibilities: phase 1 — explicit markers (numbered "1.", "1)", Spanish
//   ordinals "uno)"…, bullets "- ", "• ", "* ", line breaks, inline sequences);
//   phase 2 — connectors (y, e, comma, luego, después, también, además) split
//   within each segment's content, only when followed by a plausible item start
//   (normative predicate: determiner, quantity token, or non-stopword word —
//   mirrored in the test fixtures); single-item fallback; empty-input handling.
// Rationale: deterministic and testable by design (spec §Item Splitter); this is
//   the connector phase (jams-asb) — quantity parsing (jams-1i9) is deliberately
//   out of scope: quantity-like text stays inside the item untouched.

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
const CONNECTOR_SRC = '(?:y|e|luego|después|despues|también|tambien|además|ademas)';
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
  'tambien', 'además', 'ademas', 'luego', 'después', 'despues', 'ahora',
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

/**
 * Split a transcript into list items.
 * Contract: split(transcript: string) → Array<{ label: string, text: string }>
 * (quantity?/unit? fields are added by the quantity phase, jams-1i9.)
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
  return toItems(segments.flatMap((s) => connectorSplit(stripMarker(s))));
}
