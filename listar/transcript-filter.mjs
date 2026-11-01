// Purpose: remove empty and unreliable Whisper segments before list parsing.
// Responsibilities: apply minimum-word/confidence checks while preserving timing.
// Rationale: retain trustworthy transcript evidence and prevent noise from becoming items.

export const MIN_SEGMENT_WORDS = 2;
export const MIN_SEGMENT_CONFIDENCE = 0.35;

function wordCount(text) {
  return String(text ?? '').trim().split(/\s+/u).filter(Boolean).length;
}

function confidenceOf(segment) {
  const value = segment.score ?? segment.confidence;
  return Number.isFinite(value) ? value : null;
}

/** Filter Whisper chunks without losing the timestamps of retained segments. */
export function filterTranscript({ text = '', chunks = [] } = {}) {
  const sourceChunks = Array.isArray(chunks) ? chunks : [];
  if (sourceChunks.length === 0) {
    const cleanText = String(text).trim();
    const isShort = wordCount(cleanText) < MIN_SEGMENT_WORDS;
    return {
      text: isShort ? '' : cleanText,
      chunks: [],
      dropped: cleanText && isShort ? 1 : 0,
      droppedSegments: cleanText && isShort
        ? [{ text: cleanText, timestamp: null, reason: 'short-segment' }]
        : [],
      empty: isShort,
    };
  }

  const kept = [];
  const droppedSegments = [];
  let dropped = 0;
  for (const segment of sourceChunks) {
    const segmentText = String(segment?.text ?? '').trim();
    const confidence = confidenceOf(segment ?? {});
    const reason = wordCount(segmentText) < MIN_SEGMENT_WORDS
      ? 'short-segment'
      : confidence !== null && confidence < MIN_SEGMENT_CONFIDENCE
        ? 'low-confidence'
        : null;
    if (reason) {
      dropped++;
      droppedSegments.push({ ...segment, text: segmentText, reason });
      continue;
    }
    kept.push({ ...segment, text: segmentText });
  }
  const filteredText = kept.map(({ text: segmentText }) => segmentText).join(' ').trim();
  return {
    text: filteredText,
    chunks: kept,
    dropped,
    droppedSegments,
    empty: filteredText.length === 0,
  };
}
