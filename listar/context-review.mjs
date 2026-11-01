// Purpose: resolve contextual analysis into a reviewable, explicitly targeted command batch.
// Responsibilities: bind proposals to one snapshot, expose before/after evidence, and confirm atomically.
// Rationale: transcript interpretation must not choose item identity or persist until the user confirms.

import { analyzeWithFallback } from './analysis-router.mjs';
import { applyCommands } from './command-reducer.mjs';
import { commitCommands, readSnapshot, StaleSnapshotError } from './db.js';
import { recordDebugEvent } from './debug.mjs';

let operationCounter = 1;

function newOperationId() {
  return globalThis.crypto?.randomUUID?.() || `listar-context-${Date.now()}-${operationCounter++}`;
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function candidateAt(review, index) {
  const candidate = review.analysis.candidates[index];
  if (!candidate) throw new RangeError(`No existe la propuesta ${index + 1}.`);
  return candidate;
}

function targetChoices(review, candidate) {
  const byId = new Map(review.snapshot.items.map((item) => [item.id, item]));
  const ids = new Set(candidate.targetItemIds ?? []);
  if (candidate.intent === 'query') {
    const normalize = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es').trim().replace(/\s+/gu, ' ');
    const label = normalize(candidate.label);
    for (const item of review.snapshot.items) if (normalize(item.label) === label) ids.add(item.id);
  }
  for (const alternative of candidate.alternatives ?? []) {
    if (typeof alternative.itemId === 'string') ids.add(alternative.itemId);
    for (const id of alternative.itemIds ?? []) ids.add(id);
  }
  return [...ids].map((itemId) => byId.get(itemId)).filter(Boolean).map((item) => ({
    itemId: item.id,
    label: item.label,
    ...(item.brand === undefined ? {} : { brand: item.brand }),
    ...(item.package === undefined ? {} : { package: item.package }),
    ...(item.quantity === undefined ? {} : { quantity: item.quantity }),
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    details: Object.entries(item.attributes ?? {}).flatMap(([key, assertions]) => assertions.map((assertion) => ({
      key,
      role: assertion.role,
      value: assertion.value?.type === 'price'
        ? formatMinorAmount(assertion.value.amountMinor, assertion.value.currency)
        : assertion.value?.value ?? assertion.value,
    }))),
  }));
}

function assertionChoices(review, candidate, itemId) {
  const item = review.snapshot.items.find((entry) => entry.id === itemId);
  if (!item || !candidate.assertion?.key) return [];
  return (item.attributes?.[candidate.assertion.key] ?? []).map((assertion) => ({
    itemId,
    assertionId: assertion.id,
    role: assertion.role,
    value: clone(assertion.value),
  }));
}

function validCurrency(value) {
  return CURRENCIES.has(value);
}

function validIsoTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && !Number.isNaN(Date.parse(value));
}

const CURRENCIES = new Set(['ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'EUR', 'GBP', 'JPY', 'KWD', 'MXN', 'NZD', 'PEN', 'USD', 'UYU']);

export function currencyMinorDigits(currency) {
  if (!validCurrency(currency)) throw new TypeError(`Unsupported currency: ${currency}`);
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
}

export function amountToMinor(value, currency) {
  if (!validCurrency(currency)) return null;
  const text = String(value ?? '').trim().replace(',', '.');
  const digits = currencyMinorDigits(currency);
  const expression = digits === 0 ? /^\d+$/u : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`, 'u');
  if (!expression.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  const scale = 10 ** digits;
  const amount = Number(whole) * scale + Number(fraction.padEnd(digits, '0') || 0);
  return Number.isSafeInteger(amount) ? amount : null;
}

export function formatMinorAmount(amountMinor, currency) {
  if (!Number.isSafeInteger(amountMinor) || !validCurrency(currency)) return 'Precio sin contexto';
  const digits = currencyMinorDigits(currency);
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency, currencyDisplay: 'code',
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(amountMinor / (10 ** digits));
}

function hardReviewDiagnostic(candidate, resolution = {}) {
  const blockers = new Set([
    'target-not-found', 'quantity-unclear', 'missing-price-context', 'observation-time-required',
    'price-precision-unclear', 'unsupported-command', 'snapshot-required',
  ]);
  return candidate.diagnostics?.find(({ code }) => {
    if (!blockers.has(code)) return false;
    if (code === 'missing-price-context' && validCurrency(resolution.priceCurrency ?? candidate.assertion?.value?.currency)) return false;
    if (code === 'observation-time-required' && validIsoTimestamp(resolution.observedAt)) return false;
    if (code === 'price-precision-unclear' && amountToMinor(resolution.priceAmount ?? candidate.assertion?.amountMajor,
      resolution.priceCurrency ?? candidate.assertion?.value?.currency ?? 'ARS') !== null) return false;
    return true;
  });
}

function unresolvedDiagnostics(candidate, resolution) {
  return (candidate.diagnostics ?? []).filter(({ code }) => {
    if (code === 'duplicate-label-target') return !resolution.targetItemId;
    if (code === 'repeat-add-ambiguous' || code === 'speech-repair-ambiguous') return !resolution.action;
    if (code === 'assertion-id-required') return !['append-assertion', 'replace-assertion'].includes(resolution.action);
    if (code === 'missing-price-context') return !validCurrency(resolution.priceCurrency ?? candidate.assertion?.value?.currency);
    if (code === 'observation-time-required') return !validIsoTimestamp(resolution.observedAt);
    if (code === 'price-precision-unclear') return amountToMinor(resolution.priceAmount ?? candidate.assertion?.amountMajor,
      resolution.priceCurrency ?? candidate.assertion?.value?.currency ?? 'ARS') === null;
    return true;
  });
}

function itemAfter(snapshot, command) {
  const itemId = command.targetItemId ?? command.item?.id;
  return snapshot.items.find((item) => item.id === itemId) ?? null;
}

function commandFor(review, index, resolution = {}) {
  const candidate = candidateAt(review, index);
  const evidence = candidate.evidence?.[0];
  const explicit = (id) => {
    const choices = targetChoices(review, candidate);
    const selected = id ?? (choices.length === 1 ? choices[0].itemId : null);
    if (!selected || !choices.some(({ itemId }) => itemId === selected)) {
      throw new Error('Elige el artículo de destino por su ID para continuar.');
    }
    return selected;
  };
  if (candidate.intent === 'query') return { intent: 'query' };
  if (candidate.intent === 'review') throw new Error('Esta frase requiere revisión y no genera un cambio automático.');
  const blocker = hardReviewDiagnostic(candidate, resolution);
  if (blocker) throw new Error(blocker.message || 'Esta propuesta necesita más contexto antes de confirmarse.');

  if (candidate.intent === 'ambiguous') {
    const selectedLabel = resolution.action === 'keep-first' ? candidate.alternatives?.[0]?.label
      : resolution.action === 'replace-first' ? candidate.alternatives?.[1]?.label : null;
    if (!selectedLabel) throw new Error('Elige cómo resolver la corrección hablada.');
    return {
      intent: 'add',
      item: {
        id: `${review.operationId}:item:${index}`,
        listId: review.snapshot.listId,
        label: selectedLabel,
        text: evidence?.rawText ?? selectedLabel,
        done: false,
        createdAt: review.createdAt + index,
        order: review.createdAt + index,
        ...(evidence?.sourceAudioId ? { sourceAudioId: evidence.sourceAudioId } : {}),
      },
    };
  }

  if (candidate.intent === 'add') {
    let label = candidate.label;
    let targetId;
    let intent = 'add';
    let quantity = candidate.proposed?.quantity;
    let unit = candidate.proposed?.unit;
    if (candidate.requiresChoice) {
      if (resolution.action === 'increment-existing') {
        targetId = explicit(resolution.targetItemId);
        const target = review.snapshot.items.find(({ id }) => id === targetId);
        intent = 'increment';
        quantity ??= 1;
        unit ??= target?.unit;
        if (target?.quantity === undefined) throw new Error('No hay una cantidad base que pueda incrementarse; agrega otro artículo o edita la cantidad.');
      } else if (resolution.action !== 'add-distinct') {
        throw new Error('Elige agregar otro artículo o aumentar uno existente.');
      }
    }
    if (intent === 'increment') return { intent, targetItemId: targetId, quantity, ...(unit === undefined ? {} : { unit }) };
    return {
      intent,
      item: {
        id: `${review.operationId}:item:${index}`,
        listId: review.snapshot.listId,
        label,
        text: evidence?.rawText ?? label,
        done: false,
        createdAt: review.createdAt + index,
        order: review.createdAt + index,
        ...(quantity === undefined ? {} : { quantity }),
        ...(unit === undefined ? {} : { unit }),
        ...(evidence?.sourceAudioId ? { sourceAudioId: evidence.sourceAudioId } : {}),
      },
    };
  }

  if (candidate.intent === 'increment' || candidate.intent === 'set' || candidate.intent === 'remove') {
    const targetItemId = explicit(resolution.targetItemId);
    if (candidate.intent === 'remove') return { intent: 'remove', targetItemId };
    if (!candidate.proposed || candidate.proposed.quantity === undefined) {
      throw new Error('La cantidad no quedó clara; corrígela antes de confirmar.');
    }
    return {
      intent: candidate.intent,
      targetItemId,
      quantity: candidate.proposed.quantity,
      ...(candidate.proposed.unit === undefined ? {} : { unit: candidate.proposed.unit }),
    };
  }

  if (candidate.intent === 'update-attribute') {
    const targetItemId = explicit(resolution.targetItemId);
    const item = review.snapshot.items.find(({ id }) => id === targetItemId);
    const assertions = item?.attributes?.[candidate.assertion?.key] ?? [];
    const value = clone(candidate.assertion.value);
    const currency = resolution.priceCurrency ?? value.currency;
    if (currency) value.currency = currency;
    if (candidate.assertion.amountMajor !== undefined || resolution.priceAmount != null) {
      value.amountMinor = amountToMinor(resolution.priceAmount ?? candidate.assertion.amountMajor, currency);
      if (value.amountMinor == null) throw new Error('El precio no admite esos decimales para la moneda elegida.');
    }
    if (candidate.assertion.role === 'observation') value.observedAt = resolution.observedAt;
    const evidence = clone(candidate.assertion.evidence);
    if (candidate.assertion.role === 'observation') {
      evidence.source = String(resolution.evidenceSource ?? '').trim();
      if (!evidence.source) throw new Error('Indica dónde observaste el precio antes de guardarlo.');
      if (review.audioId) evidence.audioId = review.audioId;
    }
    if (resolution.action === 'replace-assertion') {
      const current = assertions.find(({ id }) => id === resolution.assertionId);
      if (!current || current.role !== candidate.assertion?.role) {
        throw new Error('Elige una afirmación existente del mismo tipo para conservar su rol.');
      }
      return {
        intent: 'update-attribute', operation: 'replace', targetItemId,
        key: candidate.assertion.key, assertionId: current.id,
        replacement: { value, evidence },
      };
    }
    if (resolution.action === 'append-assertion') {
      return {
        intent: 'update-attribute', operation: 'append', targetItemId,
        key: candidate.assertion.key,
        assertion: {
          id: `${review.operationId}:assertion:${index}`,
          role: candidate.assertion.role,
          value,
          evidence,
        },
      };
    }
    throw new Error('Elige una afirmación exacta para actualizar o confirma que quieres agregar una nueva.');
  }

  throw new Error('La propuesta no tiene una acción confirmable.');
}

function candidateSummary(review, index, resolution) {
  const candidate = candidateAt(review, index);
  let command = null;
  let after = null;
  let previewError = null;
  try {
    command = commandFor(review, index, resolution);
    after = itemAfter(applyCommands(review.snapshot, [command]), command);
  } catch (error) {
    previewError = error.message;
  }
  const before = command?.targetItemId
    ? review.snapshot.items.find(({ id }) => id === command.targetItemId) ?? null
    : null;
  return {
    command,
    intent: candidate.intent,
    label: candidate.label,
    evidence: candidate.evidence ?? [],
    targetChoices: targetChoices(review, candidate),
    assertionChoices: targetChoices(review, candidate).flatMap(({ itemId }) => assertionChoices(review, candidate, itemId))
      .filter(({ role }) => role === candidate.assertion?.role),
    requiresChoice: Boolean(candidate.requiresChoice || candidate.intent === 'ambiguous' || candidate.intent === 'update-attribute'),
    alternatives: clone(candidate.alternatives ?? []),
    diagnostics: clone(candidate.diagnostics ?? []),
    previewError,
    before: before ? clone(before) : null,
    after: after ? clone(after) : null,
    stateIdentity: candidate.intent === 'query',
  };
}

/** Read exactly one transactionally coherent snapshot, then analyze without mutation. */
export async function prepareContextReview(transcript, listId, {
  audioId, readSnapshotFn = readSnapshot, analyzeFn, parserAttempt, debugCorrelationId,
} = {}) {
  if (typeof listId !== 'string' || !listId.trim()) throw new TypeError('Se necesita una lista activa para analizar el dictado.');
  const correlationId = debugCorrelationId || `analysis-${Date.now()}-${operationCounter++}`;
  recordDebugEvent('analysis.start', { listId, transcript }, { correlationId });
  const snapshot = await readSnapshotFn(listId);
  if (snapshot?.listId !== listId) throw new Error('La instantánea no corresponde a la lista activa.');
  const analysisContext = { ...snapshot, ...(audioId == null ? {} : { sourceAudioId: audioId }) };
  const routed = analyzeFn
    ? { route: 'injected-deterministic', analysis: analyzeFn(transcript, analysisContext), failure: null }
    : await analyzeWithFallback(transcript, analysisContext, { parserAttempt });
  const analysis = routed.analysis;
  const candidates = analysis.candidates.map((candidate, candidateIndex) => ({
    candidateIndex,
    intent: candidate.intent,
    targetItemIds: Array.isArray(candidate.targetItemIds) ? candidate.targetItemIds : [],
    requiresChoice: candidate.requiresChoice === true,
    diagnosticCodes: (candidate.diagnostics ?? []).map(({ code }) => code).filter((code) => typeof code === 'string'),
    label: candidate.label,
    text: candidate.evidence?.map(({ rawText }) => rawText).join(' '),
  }));
  recordDebugEvent('analysis.complete', {
    listId, version: snapshot.version, route: routed.route,
    candidateCount: analysis.candidates.length,
    intents: analysis.candidates.map(({ intent }) => intent),
    candidates,
  }, { correlationId });
  return {
    transcript: String(transcript ?? ''),
    snapshot: clone(snapshot),
    analysis,
    route: routed.route,
    failure: routed.failure,
    audioId: audioId ?? null,
    debugCorrelationId: correlationId,
    operationId: newOperationId(),
    createdAt: Date.now(),
  };
}

export function getContextPreviewCards(review) {
  if (!review?.snapshot || review.analysis?.listId !== review.snapshot.listId || review.analysis?.version !== review.snapshot.version) {
    throw new TypeError('La propuesta y la instantánea no comparten la misma lista y versión.');
  }
  return review.analysis.candidates.map((_, index) => candidateSummary(review, index));
}

export function previewContextCandidate(review, index, resolution = {}) {
  const summary = candidateSummary(review, index, resolution);
  if (summary.previewError) throw new Error(summary.previewError);
  return summary;
}

function formatItem(item) {
  if (!item) return 'Sin artículo';
  const amount = item.quantity === undefined ? '' : ` × ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`;
  const price = item.attributes?.price?.length
    ? ` · precio ${item.attributes.price.map(({ id, role, value }) => `${role} ${id}: ${formatMinorAmount(value.amountMinor, value.currency)}`).join('; ')}`
    : '';
  return `${item.label}${amount}${price}`;
}

function intentLabel(intent) {
  return ({ add: 'Agregar otro artículo', increment: 'Aumentar cantidad', set: 'Cambiar cantidad', remove: 'Quitar artículo',
    'update-attribute': 'Actualizar atributo', query: 'Consulta (sin cambios)', noop: 'Sin cambios', ambiguous: 'Corrección ambigua', review: 'Revisión necesaria' })[intent] ?? intent;
}

function makeSelect(document, ariaLabel, options) {
  const select = document.createElement('select');
  select.setAttribute('aria-label', ariaLabel);
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Elige una opción';
  select.append(placeholder);
  for (const { value, text, selected = false } of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    option.selected = selected;
    select.append(option);
  }
  return select;
}

function markDiagnosticControl(control, targetId, candidateIndex) {
  control.dataset ??= {};
  control.dataset.debugTarget = targetId;
  control.dataset.debugCandidate = String(candidateIndex);
  return control;
}

/** Render the contextual preview with explicit item/assertion IDs and readable source/state evidence. */
export function renderContextPreview({ document, container, review, onChange = () => {} }) {
  if (!document?.createElement || !container?.replaceChildren) throw new TypeError('Se necesita un contenedor DOM para mostrar la revisión.');
  container.replaceChildren();
  const controls = [];
  review.analysis.candidates.forEach((candidate, index) => {
    const card = document.createElement('section');
    card.className = 'preview-row context-preview-row';
    const resolution = { selected: candidate.intent !== 'review' };
    const selected = document.createElement('input');
    markDiagnosticControl(selected, 'context-select', index);
    selected.type = 'checkbox';
    selected.checked = resolution.selected;
    selected.setAttribute('aria-label', `Incluir propuesta ${index + 1}: ${candidate.label}`);
    selected.addEventListener('change', () => {
      resolution.selected = selected.checked;
      updatePreview();
      onChange(index, { ...resolution });
    });
    card.append(selected);
    const content = document.createElement('div');
    content.className = 'preview-editor context-preview-editor';
    const title = document.createElement('strong');
    title.textContent = `${intentLabel(candidate.intent)}: ${candidate.label}`;
    content.append(title);
    const evidence = document.createElement('p');
    evidence.className = 'context-evidence';
    evidence.textContent = `Dijiste: “${candidate.evidence?.map(({ rawText }) => rawText).join(' · ') ?? review.transcript}”`;
    content.append(evidence);

    const summary = candidateSummary(review, index);
    const choices = summary.targetChoices;
    if (candidate.intent === 'query') {
      const matches = document.createElement('p');
      matches.className = 'context-query-results';
      matches.textContent = choices.length
        ? `Coincidencias (solo lectura): ${choices.map(({ itemId, label }) => `${label} · ID ${itemId}`).join('; ')}`
        : 'No hay coincidencias en esta lista.';
      content.append(matches);
    }

    const needsTarget = ['increment', 'set', 'remove', 'update-attribute'].includes(candidate.intent) || choices.length > 1;
    let targetSelect = null;
    if (needsTarget && choices.length) {
      targetSelect = makeSelect(document, `Artículo de destino para ${candidate.label}`, choices.map((item) => ({
        value: item.itemId,
        text: `${item.label} · ID ${item.itemId}${item.brand ? ` · ${item.brand}` : ''}${item.package ? ` · ${item.package}` : ''}${item.quantity === undefined ? '' : ` · ${item.quantity} ${item.unit ?? ''}`}${item.details?.length ? ` · ${item.details.map(({ key, role, value }) => `${key} (${role}): ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ')}` : ''}`,
        selected: choices.length === 1,
      })));
      markDiagnosticControl(targetSelect, 'context-target', index);
      if (choices.length === 1) resolution.targetItemId = choices[0].itemId;
      targetSelect.value = resolution.targetItemId ?? '';
      targetSelect.addEventListener('change', () => {
        resolution.targetItemId = targetSelect.value || undefined;
        if (resolution.assertionItemId && resolution.assertionItemId !== resolution.targetItemId) {
          resolution.assertionId = undefined;
          resolution.assertionItemId = undefined;
          if (assertionSelect) assertionSelect.value = '';
        }
        updatePreview();
        onChange(index, { ...resolution });
      });
      content.append(targetSelect);
    }

    let actionSelect = null;
    const actionOptions = candidate.intent === 'ambiguous'
      ? [{ value: 'keep-first', text: `Agregar ${candidate.alternatives?.[0]?.label ?? 'primera opción'}` }, { value: 'replace-first', text: `Agregar ${candidate.alternatives?.[1]?.label ?? 'corrección'}` }]
      : candidate.intent === 'add' && candidate.requiresChoice
        ? [{ value: 'add-distinct', text: 'Agregar un artículo distinto' }, { value: 'increment-existing', text: 'Aumentar un artículo existente' }]
        : candidate.intent === 'update-attribute'
          ? [{ value: 'append-assertion', text: `Agregar ${candidate.assertion?.role ?? ''}` }, { value: 'replace-assertion', text: `Actualizar una afirmación ${candidate.assertion?.role ?? ''}` }]
          : [];
    if (actionOptions.length) {
      actionSelect = makeSelect(document, `Acción para ${candidate.label}`, actionOptions);
      markDiagnosticControl(actionSelect, 'context-action', index);
      actionSelect.addEventListener('change', () => {
        resolution.action = actionSelect.value || undefined;
        if (candidate.intent === 'update-attribute') {
          const assertion = summary.assertionChoices.find(({ assertionId, itemId }) =>
            assertionId === resolution.assertionId && itemId === resolution.assertionItemId);
          if (resolution.action === 'replace-assertion' && !assertion && summary.assertionChoices.length === 1) {
            resolution.assertionId = summary.assertionChoices[0].assertionId;
            resolution.assertionItemId = summary.assertionChoices[0].itemId;
            resolution.targetItemId = summary.assertionChoices[0].itemId;
            if (targetSelect) targetSelect.value = resolution.targetItemId;
          }
        }
        updatePreview();
        onChange(index, { ...resolution });
      });
      content.append(actionSelect);
    }

    if (candidate.intent === 'update-attribute' && candidate.assertion?.value?.type === 'price') {
      const amountLabel = document.createElement('label');
      amountLabel.textContent = 'Precio';
      const amount = document.createElement('input');
      markDiagnosticControl(amount, 'context-amount', index);
      const initialCurrency = candidate.assertion.value.currency ?? 'ARS';
      const fractionDigits = currencyMinorDigits(initialCurrency);
      amount.type = 'number';
      amount.min = '0';
      amount.step = fractionDigits === 0 ? '1' : `0.${'0'.repeat(fractionDigits - 1)}1`;
      amount.value = candidate.assertion.amountMajor ?? (candidate.assertion.value.amountMinor == null
        ? '' : String(candidate.assertion.value.amountMinor / (10 ** fractionDigits)));
      amount.setAttribute('aria-label', `Precio de ${candidate.label}`);
      amount.addEventListener('input', () => {
        resolution.priceAmount = amount.value;
        updatePreview();
        onChange(index, { ...resolution });
      });
      amountLabel.append(amount);
      content.append(amountLabel);

      const currency = makeSelect(document, `Moneda del precio de ${candidate.label}`,
        ['ARS', 'AUD', 'BRL', 'CAD', 'CHF', 'CLP', 'CNY', 'EUR', 'GBP', 'JPY', 'KWD', 'MXN', 'NZD', 'PEN', 'USD', 'UYU'].map((code) => ({
          value: code, text: code, selected: candidate.assertion.value.currency === code,
        })));
      markDiagnosticControl(currency, 'context-currency', index);
      currency.value = candidate.assertion.value.currency ?? '';
      currency.addEventListener('change', () => {
        resolution.priceCurrency = currency.value || undefined;
        amount.step = currency.value ? (currencyMinorDigits(currency.value) === 0 ? '1' : `0.${'0'.repeat(currencyMinorDigits(currency.value) - 1)}1`) : '0.01';
        updatePreview();
        onChange(index, { ...resolution });
      });
      content.append(currency);

      if (candidate.assertion.role === 'observation') {
        const observedLabel = document.createElement('label');
        observedLabel.textContent = 'Cuándo lo observaste';
        const observedAt = document.createElement('input');
        markDiagnosticControl(observedAt, 'context-observed-at', index);
        observedAt.type = 'datetime-local';
        observedAt.setAttribute('aria-label', `Fecha y hora de observación para ${candidate.label}`);
        observedAt.addEventListener('input', () => {
          const parsed = observedAt.value ? new Date(observedAt.value) : null;
          resolution.observedAt = parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : undefined;
          updatePreview();
          onChange(index, { ...resolution });
        });
        observedLabel.append(observedAt);
        content.append(observedLabel);

        const sourceLabel = document.createElement('label');
        sourceLabel.textContent = 'Dónde lo observaste';
        const source = document.createElement('input');
        markDiagnosticControl(source, 'context-source', index);
        source.type = 'text';
        source.placeholder = 'Tienda, ticket…';
        source.setAttribute('aria-label', `Fuente del precio para ${candidate.label}`);
        source.addEventListener('input', () => {
          resolution.evidenceSource = source.value;
          updatePreview();
          onChange(index, { ...resolution });
        });
        sourceLabel.append(source);
        content.append(sourceLabel);
      }
    }

    let assertionSelect = null;
    if (summary.assertionChoices.length) {
      assertionSelect = makeSelect(document, `Afirmación de precio para ${candidate.label}`, summary.assertionChoices.map(({ itemId, assertionId, role, value }) => ({
        value: `${itemId}::${assertionId}`,
        text: `${role} · ${assertionId} · ${formatMinorAmount(value.amountMinor, value.currency)}`,
        selected: summary.assertionChoices.length === 1,
      })));
      markDiagnosticControl(assertionSelect, 'context-assertion', index);
      if (summary.assertionChoices.length === 1) {
        resolution.assertionId = summary.assertionChoices[0].assertionId;
        resolution.assertionItemId = summary.assertionChoices[0].itemId;
        resolution.targetItemId = summary.assertionChoices[0].itemId;
      }
      assertionSelect.value = resolution.assertionId ? `${resolution.assertionItemId}::${resolution.assertionId}` : '';
      assertionSelect.addEventListener('change', () => {
        const [itemId, assertionId] = assertionSelect.value.split('::');
        resolution.targetItemId = itemId || undefined;
        resolution.assertionItemId = itemId || undefined;
        resolution.assertionId = assertionId || undefined;
        if (targetSelect) targetSelect.value = resolution.targetItemId ?? '';
        updatePreview();
        onChange(index, { ...resolution });
      });
      content.append(assertionSelect);
    }

    const before = document.createElement('p');
    before.className = 'context-before-after';
    const after = document.createElement('p');
    after.className = 'context-before-after';
    const diagnostic = document.createElement('p');
    diagnostic.className = 'context-diagnostic';
    diagnostic.setAttribute('role', 'status');
    content.append(before, after, diagnostic);
    const updatePreview = () => {
      try {
        const current = previewContextCandidate(review, index, resolution);
        const chosen = current.command?.targetItemId
          ? review.snapshot.items.find(({ id }) => id === current.command.targetItemId)
          : null;
        before.textContent = current.stateIdentity
          ? `Coincidencias: ${current.targetChoices.length ? current.targetChoices.map(({ label, itemId }) => `${label} · ID ${itemId}`).join('; ') : 'ninguna'}`
          : `Antes: ${formatItem(chosen)}`;
        after.textContent = current.stateIdentity ? 'Después: Sin cambios' : `Después: ${formatItem(current.after)}`;
        diagnostic.textContent = unresolvedDiagnostics(candidate, resolution).map(({ message }) => message).join(' ');
      } catch (error) {
        before.textContent = 'Antes: Revisa la propuesta';
        after.textContent = 'Después: Sin cambios confirmados';
        diagnostic.textContent = error.message;
      }
    };
    updatePreview();
    card.append(content);
    container.append(card);
    controls.push(resolution);
  });
  return {
    readResolutions() { return Object.fromEntries(controls.map((value, index) => [index, { ...value }])); },
  };
}

export function createContextConfirmation(initialReview, {
  commitFn = commitCommands,
  readSnapshotFn = readSnapshot,
  analyzeFn,
  parserAttempt,
} = {}) {
  let review = initialReview;
  let active = true;
  let busy = false;
  let completed = false;
  return {
    getReview() { return review; },
    cancel() {
      if (busy || completed || !active) return false;
      active = false;
      return true;
    },
    async confirm(resolutions = {}) {
      if (!active || busy || completed) return { status: 'cancelled' };
      busy = true;
      const correlationId = `preview-${review.snapshot.listId}-${review.snapshot.version}-${review.operationId}`;
      recordDebugEvent('preview.confirm.start', { listId: review.snapshot.listId, version: review.snapshot.version }, { correlationId, operationId: review.operationId });
      try {
        const commands = [];
        let selectedIdentity = false;
        for (let index = 0; index < review.analysis.candidates.length; index++) {
          const resolution = resolutions[index] ?? {};
          if (resolution.selected === false) continue;
          const candidate = candidateAt(review, index);
          if (candidate.intent === 'query' || candidate.intent === 'noop') {
            selectedIdentity = true;
            continue;
          }
          commands.push(commandFor(review, index, resolution));
        }
        if (!commands.length) {
          completed = true;
          active = false;
          recordDebugEvent('preview.confirm.identity', { selectedIdentity, commandCount: 0 }, { correlationId, operationId: review.operationId });
          return { status: selectedIdentity ? 'identity' : 'empty', snapshot: review.snapshot };
        }
        applyCommands(review.snapshot, commands);
        try {
          recordDebugEvent('preview.confirm.commands', { commandCount: commands.length, intents: commands.map(({ intent }) => intent) }, { correlationId, operationId: review.operationId });
          const result = await commitFn({ snapshot: review.snapshot, commands, operationId: review.operationId });
          completed = true;
          active = false;
          recordDebugEvent('preview.confirm.complete', { listId: result.listId, version: result.version, commandCount: commands.length }, { correlationId, operationId: review.operationId });
          return { status: 'committed', result, commands };
        } catch (error) {
          if (!(error instanceof StaleSnapshotError) && error?.code !== 'stale-snapshot') {
            recordDebugEvent('preview.confirm.error', { errorName: error?.name || 'Error' }, { correlationId, operationId: review.operationId });
            throw error;
          }
          recordDebugEvent('preview.confirm.stale', { errorName: error?.name || 'StaleSnapshotError' }, { correlationId, operationId: review.operationId });
          review = await prepareContextReview(review.transcript, review.snapshot.listId, {
            audioId: review.audioId, readSnapshotFn, analyzeFn, parserAttempt,
            debugCorrelationId: review.debugCorrelationId,
          });
          active = false;
          return { status: 'stale', review };
        }
      } finally {
        busy = false;
      }
    },
  };
}

/** Bind a confirmation session to a form while keeping error/stale previews available for correction. */
export function bindContextConfirmation({
  form, getConfirmation, getResolutions, onBusy = () => {}, onSuccess = () => {}, onStale = () => {}, onError = () => {},
}) {
  let busy = false;
  let active = true;
  let completed = false;
  const submit = async (event) => {
    event.preventDefault();
    if (!active || busy || completed) return;
    busy = true;
    onBusy(true);
    try {
      const result = await getConfirmation().confirm(getResolutions());
      if (result.status === 'stale') {
        await onStale(result.review);
        return;
      }
      completed = true;
      active = false;
      form.removeEventListener('submit', submit);
      await onSuccess(result);
    } catch (error) {
      await onError(error);
    } finally {
      busy = false;
      onBusy(false);
    }
  };
  form.addEventListener('submit', submit);
  return {
    cancel() {
      if (!active || busy || completed || !getConfirmation().cancel()) return false;
      active = false;
      form.removeEventListener('submit', submit);
      return true;
    },
  };
}

/** Keep plain item extraction distinct from contextual command routing. */
export function isAppendOnlyExtraction(analysis) {
  const normalized = String(analysis?.transcript ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  const commandOrQuestion = /(?:^|\s)(?:agrega|agregue|anade|compra|pon|pone|saca|sacame|quita|quitame|elimina|eliminame|borra|borrame|cambia|actualiza|marca|tacha|mueve|ordena|limpia|trae|lleva|quiero|necesito|falta|faltan|queda|quedan|consulta|averigua|revisa|no\s+mas|hasta|maximo|otro|otra|hay|tenemos|tengo|cuanto|cuanta|cuantos|cuantas|que|donde|cual|cuales|cuando|quien|quienes|se\s+acabo)(?=\s|$)|[¿?]|\bno\b/u.test(normalized);
  return Boolean(!commandOrQuestion && analysis && analysis.candidates.length > 0 && analysis.candidates.every((candidate) =>
    candidate.intent === 'review' && candidate.diagnostics?.some(({ code }) => code === 'unsupported-command')));
}
