// Purpose: propose contextual commands from transcript text without mutation.
// Responsibilities: preserve source spans, attach list snapshot identity, and expose unresolved choices.
// Rationale: analysis is a proposal boundary; confirmation and persistence belong to later layers.

import { split } from './splitter.js';

const CLAUSE_BREAK = /(?<!\d),(?!\d)|[;\n]+|\b(?:y|e|luego|después|despues|además|ademas|también|tambien)\b/giu;
const ITEM_WORDS = new Set(['de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'no', 'sí', 'si', 'ya', 'hay', 'que', 'para']);

function copy(value) {
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch { return value; }
  }
  try { return value == null ? value : JSON.parse(JSON.stringify(value)); }
  catch { return value; }
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/g, ' ');
}

function words(value) {
  return normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
}

function clausesOf(transcript) {
  const clauses = [];
  let start = 0;
  for (const match of transcript.matchAll(CLAUSE_BREAK)) {
    const left = transcript.slice(start, match.index);
    const rightStart = match.index + match[0].length;
    const right = transcript.slice(rightStart);
    const rightWord = words(right)[0];
    if (left.trim() && rightWord && !ITEM_WORDS.has(rightWord)) {
      clauses.push({ rawText: left.trim(), start: start + left.search(/\S/u), end: start + left.trimEnd().length });
      start = rightStart;
    }
  }
  const tail = transcript.slice(start);
  if (tail.trim()) clauses.push({ rawText: tail.trim(), start: start + tail.search(/\S/u), end: start + tail.trimEnd().length });
  return clauses;
}

function contextFields(context) {
  const snapshot = context && typeof context === 'object' ? copy(context) : null;
  const valid = Boolean(snapshot && typeof snapshot.listId === 'string' && snapshot.listId.trim() &&
    Number.isInteger(snapshot.version) && snapshot.version >= 0 && Array.isArray(snapshot.items) &&
    snapshot.items.every((item) => item && typeof item === 'object' && !Array.isArray(item) &&
      typeof item.id === 'string' && typeof item.label === 'string'));
  return {
    snapshot,
    valid,
    listId: valid ? snapshot.listId : snapshot?.listId ?? null,
    version: valid ? snapshot.version : snapshot?.version ?? null,
    items: valid ? snapshot.items.filter((item) => item.listId == null || item.listId === snapshot.listId) : [],
  };
}

function sourceEvidence(clause, audioId) {
  return {
    source: 'transcript',
    rawText: clause.rawText,
    start: clause.start,
    end: clause.end,
    ...(audioId == null ? {} : { audioId, sourceAudioId: audioId }),
  };
}

function cleanTarget(text) {
  return String(text)
    .replace(/^[¿¡?!.]+/u, '')
    .replace(/^(?:agrega|agregá|agregue|añade|anade|añadí|anadi|compra|comprá|pon|pone|poné|poneme|saca|sacá|quita|quitá|borra|borrá|elimina|eliminá)\s+/iu, '')
    .replace(/^(?:otro|otra)\s+/iu, '')
    .replace(/^(?:ya\s+)?(?:hay|tenemos|tengo)\s+/iu, '')
    .replace(/^(?:la|el|los|las|un|una)\s+/iu, '')
    .replace(/[?¿¡!.]+$/gu, '')
    .trim();
}

function itemLabel(rawText) {
  const cleaned = cleanTarget(rawText);
  const parsed = split(cleaned);
  return parsed.length === 1 ? parsed[0].label : cleaned;
}

function matchedItems(label, items) {
  const key = normalize(label);
  return items.filter((item) => normalize(item?.label) === key);
}

function amountMinorOf(decimalText) {
  const [wholeText, fraction = ''] = String(decimalText).replace(',', '.').split('.');
  if (fraction.length > 2 || !/^\d+$/u.test(wholeText) || !/^\d*$/u.test(fraction)) return null;
  const amount = Number(wholeText) * 100 + Number(fraction.padEnd(2, '0') || 0);
  return Number.isSafeInteger(amount) ? amount : null;
}

function contextualTargets(label, items) {
  const matches = matchedItems(label, items);
  return {
    targetItemIds: matches.map(({ id }) => id).filter((id) => id != null),
    alternatives: matches.map(({ id, label: itemLabelValue }) => ({ itemId: id, label: itemLabelValue })),
    requiresChoice: matches.length > 1,
  };
}

function makeCandidate(clause, intent, fields, audioId, extra = {}) {
  const evidence = sourceEvidence(clause, audioId);
  const label = extra.label ?? itemLabel(clause.rawText);
  const targets = intent === 'add' || intent === 'query' || intent === 'ambiguous'
    ? { targetItemIds: [], alternatives: [], requiresChoice: false }
    : contextualTargets(label, fields.items);
  const targetAssertionIds = extra.targetAssertionIds ?? (intent === 'update-attribute'
    ? fields.items.filter(({ id }) => targets.targetItemIds.includes(id))
      .flatMap((item) => (Array.isArray(item.attributes?.price) ? item.attributes.price : [])
        .filter((assertion) => assertion.role === extra.assertion?.role)
        .map(({ id }) => id))
    : []);
  const diagnostics = [...(extra.diagnostics ?? [])];
  if (!fields.valid) diagnostics.push({ code: 'snapshot-required', message: 'Se necesita una lista activa con versión para proponer un cambio.' });
  if (targets.requiresChoice) diagnostics.push({ code: 'duplicate-label-target', message: 'Hay varios artículos con el mismo nombre; elige uno.' });
  if ((intent === 'increment' || intent === 'set' || intent === 'remove' || intent === 'update-attribute') && targets.targetItemIds.length === 0) {
    diagnostics.push({ code: 'target-not-found', message: 'No se encontró un artículo de destino en esta lista.' });
  }
  const needsChoice = Boolean(extra.requiresChoice || targets.requiresChoice || !fields.valid || diagnostics.some(({ code }) => ['target-not-found', 'missing-price-context', 'observation-time-required', 'assertion-id-required', 'price-precision-unclear', 'speech-repair-ambiguous'].includes(code)));
  return {
    intent: fields.valid ? intent : 'review',
    listId: fields.listId,
    version: fields.version,
    label,
    targetItemIds: fields.valid ? targets.targetItemIds : [],
    targetAssertionIds: fields.valid ? targetAssertionIds : [],
    ...(extra.proposed ? { proposed: extra.proposed } : {}),
    ...(extra.assertion ? { assertion: extra.assertion } : {}),
    alternatives: extra.alternatives ?? targets.alternatives,
    requiresChoice: needsChoice,
    stateIdentity: fields.valid && intent === 'query',
    evidence: [evidence],
    diagnostics,
  };
}

function parseQuantity(text) {
  let stripped = String(text).replace(/^(?:pon|pone|poné|poneme|agrega|agregá|agregue|añade|anade|añadí|anadi|compra|comprá)\s+/iu, '');
  if (/^(?:otro|otra)\s+/iu.test(stripped)) stripped = `1 ${stripped.replace(/^(?:otro|otra)\s+/iu, '')}`;
  const parsed = split(stripped);
  return parsed.length === 1 && parsed[0].quantity !== undefined
    ? { label: parsed[0].label, quantity: parsed[0].quantity, unit: parsed[0].unit }
    : null;
}

function candidateFor(clause, fields, audioId) {
  const raw = clause.rawText;
  const repair = raw.match(/^\s*(.+?)\s+no\s+(.+?)\s*$/iu);
  if (repair) {
    return makeCandidate(clause, 'ambiguous', fields, audioId, {
      label: repair[1].trim(), requiresChoice: true,
      alternatives: [repair[1], repair[2]].map((label) => ({ label: label.trim(), action: 'keep-or-replace' })),
      diagnostics: [{ code: 'speech-repair-ambiguous', message: 'Confirma si querías corregir el primer artículo.' }],
    });
  }

  if (/^(?:¿)?(?:ya\s+)?(?:hay|tenemos|tengo)\b/iu.test(raw)) {
    return makeCandidate(clause, 'query', fields, audioId, { label: cleanTarget(raw) });
  }

  const requirement = raw.match(/^(?:no\s+m[aá]s\s+de|hasta|m[aá]ximo\s+de)\s+(\d+(?:[.,]\d+)?)\s+(pesos?|ars)\s+por\s+(litro|kilo|kg|gramo|unidad|paquete)\s+(?:para\s+)?(?:la\s+|el\s+)?(.+)$/iu);
  const observation = raw.match(/^(?:la\s+|el\s+)?(.+?)\s+(?:sale|cuesta|vale)\s+(\d+(?:[.,]\d+)?)\s+(pesos?|ars)\s+por\s+(litro|kilo|kg|gramo|unidad|paquete)\s*$/iu);
  const price = requirement || observation;
  if (price) {
    const amountMajor = price[requirement ? 1 : 2].replace(',', '.');
    const amountMinor = amountMinorOf(amountMajor);
    const currencyWord = price[requirement ? 2 : 3].toLocaleLowerCase('es');
    const basisWord = price[requirement ? 3 : 4].toLocaleLowerCase('es');
    const label = price[requirement ? 4 : 1].trim();
    const role = requirement ? 'requirement' : 'observation';
    const basis = /litro/u.test(basisWord) ? { type: 'volume', unit: 'L', quantity: 1 }
      : /kilo|kg|gramo/u.test(basisWord) ? { type: 'mass', unit: /gramo/u.test(basisWord) ? 'g' : 'kg', quantity: 1 }
        : basisWord === 'paquete' ? { type: 'package', unit: 'package', quantity: 1 }
          : { type: 'item' };
    const currency = currencyWord === 'ars' ? 'ARS' : null;
    const assertion = {
      key: 'price', role, amountMajor,
      value: { type: 'price', amountMinor, currency, basis },
      evidence: { rawText: raw, source: 'transcript' },
    };
    const diagnostics = [];
    if (amountMinor == null) diagnostics.push({ code: 'price-precision-unclear', message: 'Aclara el precio; se admiten hasta dos decimales.' });
    if (!currency) diagnostics.push({ code: 'missing-price-context', message: 'Aclara el código de moneda; “pesos” puede referirse a distintas monedas.' });
    if (role === 'observation') diagnostics.push({ code: 'observation-time-required', message: 'Confirma cuándo y dónde observaste este precio.' });
    diagnostics.push({ code: 'assertion-id-required', message: 'La confirmación debe asignar un ID único a esta afirmación.' });
    return makeCandidate(clause, 'update-attribute', fields, audioId, {
      label, assertion,
      diagnostics,
    });
  }

  const increment = /^(?:otro|otra)\s+/iu.test(raw);
  const set = /^(?:pon|pone|poné|poneme)\s+/iu.test(raw);
  const remove = /^(?:saca|sacá|quita|quitá|borra|borrá|elimina|eliminá)\s+/iu.test(raw);
  const add = /^(?:agrega|agregá|agregue|añade|anade|añadí|anadi|compra|comprá)\s+/iu.test(raw);
  if (increment || set) {
    const quantity = parseQuantity(raw);
    const label = quantity?.label ?? itemLabel(raw);
    return makeCandidate(clause, increment ? 'increment' : 'set', fields, audioId, {
      label, ...(quantity ? { proposed: quantity } : {}),
      ...(!quantity ? { requiresChoice: true, diagnostics: [{ code: 'quantity-unclear', message: 'Aclara la cantidad y unidad.' }] } : {}),
    });
  }
  if (remove) return makeCandidate(clause, 'remove', fields, audioId, { label: itemLabel(raw) });
  if (add) {
    const label = itemLabel(raw);
    const quantity = parseQuantity(raw);
    const existing = matchedItems(label, fields.items);
    return makeCandidate(clause, 'add', fields, audioId, {
      label,
      ...(quantity ? { proposed: { quantity: quantity.quantity, unit: quantity.unit } } : {}),
      ...(existing.length ? {
        requiresChoice: true,
        alternatives: [{ action: 'add-distinct' }, { action: 'increment-existing', itemIds: existing.map(({ id }) => id) }],
        diagnostics: [{ code: 'repeat-add-ambiguous', message: 'Confirma si quieres agregar otro artículo o aumentar uno existente.' }],
      } : {}),
    });
  }

  return makeCandidate(clause, 'review', fields, audioId, {
    label: itemLabel(raw), requiresChoice: true,
    diagnostics: [{ code: 'unsupported-command', message: 'No se pudo clasificar con seguridad; revisa la frase antes de agregar.' }],
  });
}

/** Analyze transcript against a coherent list snapshot; this function never mutates either input. */
export function analyze(transcript, context = {}) {
  const source = String(transcript ?? '');
  const fields = contextFields(context);
  const sourceAudioId = context?.sourceAudioId ?? context?.audioId ?? null;
  const clauses = clausesOf(source);
  const mentions = clauses.map((clause) => ({
    ...clause,
    ...(sourceAudioId == null ? {} : { audioId: sourceAudioId, sourceAudioId }),
  }));
  const candidates = clauses.map((clause) => candidateFor(clause, fields, sourceAudioId));
  return {
    transcript: source,
    snapshot: fields.snapshot,
    listId: fields.listId,
    version: fields.version,
    mentions,
    candidates,
    diagnostics: candidates.flatMap(({ diagnostics: entries }) => entries),
    legacyItems: split(source),
  };
}
