// splitter.js — Listar transcript→items splitter (marker phase)
// Purpose: turn a Whisper transcript into list items using explicit markers only.
// Responsibilities: numbered ("1.", "1)", "uno)") and bulleted ("- ", "• ", "* ")
//   markers, line breaks, inline marker sequences; single-item fallback.
// Rationale: deterministic and testable by design (spec §Item Splitter); this is
//   the marker phase (jams-3n2) — connectors (jams-asb) and quantity parsing
//   (jams-1i9) are deliberately out of scope here.

// Marker core: number ("1."), Spanish ordinal ("uno)"), bullet ("-", "•", "*")
const MARKER_SRC = '(?:\\d+\\s*[.)]|(?:uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\\s*\\)|[-•*])';
// Leading marker on a line/segment (trailing space optional: bare "1." lines)
const MARKER_RE = new RegExp(`^${MARKER_SRC}\\s*`);
// Marker starting a new segment mid-line (Whisper rarely emits newlines)
const INLINE_MARKER_RE = new RegExp(`(?:^|\\s)${MARKER_SRC}\\s+`, 'g');
// Lookahead split point: whitespace followed by an inline marker
const INLINE_SPLIT_RE = new RegExp(`\\s+(?=${MARKER_SRC}\\s+)`);

function stripMarker(segment) {
  return segment.replace(MARKER_RE, '').trim();
}

function countInlineMarkers(line) {
  return (line.match(new RegExp(INLINE_MARKER_RE.source, 'g')) || []).length;
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

  // Multiple lines: each line is an item; strip its leading marker if any.
  if (lines.length > 1) {
    return lines
      .map((line) => {
        const text = stripMarker(line);
        return { label: text, text };
      })
      .filter((item) => item.text.length > 0);
  }

  // Single line: split on inline marker sequences when there are ≥2 of them.
  const line = lines[0];
  if (countInlineMarkers(line) >= 2) {
    const parts = line
      .split(INLINE_SPLIT_RE)
      .map(stripMarker)
      .filter((p) => p.length > 0);
    return parts.map((text) => ({ label: text, text }));
  }

  // Fallback: no markers → the whole transcript is one item (marker stripped).
  const text = stripMarker(line);
  return [{ label: text, text }];
}
