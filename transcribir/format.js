(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TranscribirFormat = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function pad(n) { return String(n).padStart(2, '0'); }
  function timestamp(sec, separator) {
    const safeSeconds = Number.isFinite(sec) && sec >= 0 ? sec : 0;
    const totalMilliseconds = Math.round(safeSeconds * 1000);
    const h = Math.floor(totalMilliseconds / 3600000);
    const m = Math.floor((totalMilliseconds % 3600000) / 60000);
    const s = Math.floor((totalMilliseconds % 60000) / 1000);
    const ms = totalMilliseconds % 1000;
    return `${pad(h)}:${pad(m)}:${pad(s)}${separator}${String(ms).padStart(3, '0')}`;
  }

  function srtTime(sec) { return timestamp(sec, ','); }
  function vttTime(sec) { return timestamp(sec, '.'); }

  function toSRT(chunks) {
    return chunks.map((chunk, index) => {
      const start = srtTime(chunk.timestamp[0]);
      const end = srtTime(chunk.timestamp[1] !== null ? chunk.timestamp[1] : chunk.timestamp[0] + 1);
      return `${index + 1}\n${start} --> ${end}\n${chunk.text.trim()}\n`;
    }).join('\n');
  }

  function toVTT(chunks) {
    return 'WEBVTT\n\n' + chunks.map((chunk) => {
      const start = vttTime(chunk.timestamp[0]);
      const end = vttTime(chunk.timestamp[1] !== null ? chunk.timestamp[1] : chunk.timestamp[0] + 1);
      return `${start} --> ${end}\n${chunk.text.trim()}\n`;
    }).join('\n');
  }

  function combineBatchTranscriptions(items) {
    return items
      .filter((item) => item.text)
      .map((item) => `## ${item.name}\n\n${item.text}`)
      .join('\n\n');
  }

  return { srtTime, vttTime, toSRT, toVTT, combineBatchTranscriptions };
}));
