// Purpose: render contextual review previews and bind confirmation forms without analysis authority.
// Responsibilities: build preview cards, render resolution controls with readable
//   before/after evidence, and bind form submission to a confirmation session.
// Rationale: presentation must stay separate from interpretation so the inline
//   redesign can change rendering independently; commands are produced only by
//   context-review.mjs, which re-exports this API for compatibility.

import {
  candidateAt, commandFor, itemAfter, targetChoices, assertionChoices, clone,
  unresolvedDiagnostics, currencyMinorDigits, formatMinorAmount,
} from './context-review.mjs';
import { applyCommands } from './command-reducer.mjs';

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
