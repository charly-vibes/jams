import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { List, Item, readSnapshot, commitCommands, ReloadRequiredError, setUpgradeBlockedHandler } from '../db.js';
import {
  prepareContextReview, getContextPreviewCards, previewContextCandidate,
  createContextConfirmation, isAppendOnlyExtraction, renderContextPreview, bindContextConfirmation,
  currencyMinorDigits, amountToMinor, formatMinorAmount,
} from '../context-review.mjs';

class FakeElement {
  constructor(tag) { this.tagName = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; this.value = ''; this.checked = false; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.({ target: this }); }
  get textContent() { return this._textContent ?? this.children.map((child) => child.textContent).join(''); }
  set textContent(value) { this._textContent = String(value); }
  find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const found = child.find?.(predicate); if (found) return found; } return null; }
}

test('context review obtains one coherent active-list snapshot and keeps target choices list-scoped', async () => {
  const list = await List.add({ name: 'Context snapshot' });
  const milkOne = await Item.add({ listId: list.id, label: 'leche', attributes: {
    brand: [{ id: 'brand-a', role: 'observation', value: { type: 'text', value: 'Marca A' }, evidence: { source: 'ticket' } }],
    package: [{ id: 'package-bottle', role: 'observation', value: { type: 'text', value: 'botella' }, evidence: { source: 'ticket' } }],
  } });
  const milkTwo = await Item.add({ listId: list.id, label: 'leche', attributes: {
    brand: [{ id: 'brand-b', role: 'observation', value: { type: 'text', value: 'Marca B' }, evidence: { source: 'ticket' } }],
    package: [{ id: 'package-box', role: 'observation', value: { type: 'text', value: 'caja' }, evidence: { source: 'ticket' } }],
  } });
  const foreign = await List.add({ name: 'Other list' });
  const foreignMilk = await Item.add({ listId: foreign.id, label: 'leche' });
  let reads = 0;
  const review = await prepareContextReview('sacá la leche', list.id, {
    readSnapshotFn: async (id) => { reads++; return readSnapshot(id); },
  });
  assert.equal(reads, 1);
  assert.equal(review.snapshot.listId, list.id);
  const card = getContextPreviewCards(review)[0];
  assert.equal(card.requiresChoice, true);
  assert.deepEqual(card.targetChoices.map(({ itemId }) => itemId), [milkOne.id, milkTwo.id]);
  assert.deepEqual(card.targetChoices.map(({ label }) => label), ['leche', 'leche']);
  assert.deepEqual(card.targetChoices.map(({ details }) => details.map(({ value }) => value)), [['Marca A', 'botella'], ['Marca B', 'caja']]);
  assert.equal(card.targetChoices.some(({ itemId }) => itemId === foreignMilk.id), false);
});

test('context review rejects a snapshot whose list identity differs from the requested target', async () => {
  await assert.rejects(prepareContextReview('agregá pan', 'active', {
    readSnapshotFn: async () => ({ listId: 'other', version: 0, items: [] }),
  }), /lista activa/);
});

test('duplicate-label remove cannot become a command without an explicit stable target', async () => {
  const list = await List.add({ name: 'Ambiguous target' });
  await Item.add({ listId: list.id, label: 'leche' });
  const milkB = await Item.add({ listId: list.id, label: 'leche' });
  const review = await prepareContextReview('sacá la leche', list.id);
  assert.throws(() => previewContextCandidate(review, 0), /elige|destino|resolución/i);
  const resolved = previewContextCandidate(review, 0, { targetItemId: milkB.id });
  assert.equal(resolved.command.targetItemId, milkB.id);
  assert.deepEqual({ id: resolved.before.id, label: resolved.before.label }, { id: milkB.id, label: 'leche' });
  assert.deepEqual(resolved.after, null);
});

test('DOM contextual preview shows action, exact stable target, evidence, and before/after then emits explicit resolution', async () => {
  const list = await List.add({ name: 'Visible context review' });
  const milkA = await Item.add({ listId: list.id, label: 'leche', quantity: 1, unit: 'litros', attributes: {
    brand: [{ id: 'visible-brand-a', role: 'observation', value: { type: 'text', value: 'Marca A' }, evidence: {} }],
  } });
  const milkB = await Item.add({ listId: list.id, label: 'leche', quantity: 2, unit: 'litros', attributes: {
    package: [{ id: 'visible-package-b', role: 'observation', value: { type: 'text', value: 'caja' }, evidence: {} }],
  } });
  const review = await prepareContextReview('sacá la leche', list.id);
  const container = new FakeElement('div');
  const rendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container, review });
  const copy = container.textContent;
  assert.match(copy, /Quitar artículo/);
  assert.match(copy, /Dijiste: “sacá la leche”/);
  assert.match(copy, new RegExp(`ID ${milkA.id}`));
  assert.match(copy, new RegExp(`ID ${milkB.id}`));
  const targetOptions = container.find((node) => node.attributes['aria-label'] === 'Artículo de destino para leche').children.map(({ textContent }) => textContent).join(' ');
  assert.match(targetOptions, /Marca A/);
  assert.match(targetOptions, /caja/);
  assert.match(copy, /Antes:/);
  assert.match(copy, /Después:/);
  const target = container.find((node) => node.attributes['aria-label'] === 'Artículo de destino para leche');
  target.value = milkB.id;
  target.dispatch('change');
  assert.equal(rendered.readResolutions()[0].targetItemId, milkB.id);
  assert.equal(rendered.readResolutions()[0].selected, true);
});

test('different brand and package labels remain distinct and compatible-unit validation is explicit', async () => {
  const list = await List.add({ name: 'Units and brands' });
  const milk = await Item.add({ listId: list.id, label: 'leche entera marca A botella', quantity: 1, unit: 'litros' });
  await Item.add({ listId: list.id, label: 'leche entera marca B caja', quantity: 1, unit: 'litros' });
  const review = await prepareContextReview('otro kilo de leche entera marca A botella', list.id);
  const card = getContextPreviewCards(review)[0];
  assert.deepEqual(card.targetChoices.map(({ itemId }) => itemId), [milk.id]);
  assert.throws(() => previewContextCandidate(review, 0), /unidad|conversion|compatible/i);
});

test('repeated agrega leche requires the user to choose a distinct add or explicit increment target', async () => {
  const list = await List.add({ name: 'Repeated add' });
  const milk = await Item.add({ listId: list.id, label: 'leche', quantity: 1, unit: 'litros' });
  const review = await prepareContextReview('agregá leche', list.id);
  assert.throws(() => previewContextCandidate(review, 0), /elige|decide|resolución/i);
  const separate = previewContextCandidate(review, 0, { action: 'add-distinct' });
  assert.equal(separate.command.intent, 'add');
  assert.equal(separate.command.item.id.includes('milk'), false);
  const increment = previewContextCandidate(review, 0, { action: 'increment-existing', targetItemId: milk.id });
  assert.deepEqual({ intent: increment.command.intent, targetItemId: increment.command.targetItemId, quantity: increment.command.quantity, unit: increment.command.unit }, {
    intent: 'increment', targetItemId: milk.id, quantity: 1, unit: 'litros',
  });
  assert.deepEqual({ id: increment.after.id, label: increment.after.label, quantity: increment.after.quantity, unit: increment.after.unit }, { id: milk.id, label: 'leche', quantity: 2, unit: 'litros' });
});

test('speech repair requires a keep-or-replace choice and proposes only the selected item', async () => {
  const list = await List.add({ name: 'Repair' });
  const review = await prepareContextReview('leche no yogur', list.id);
  assert.throws(() => previewContextCandidate(review, 0), /elige|corrección|resolución/i);
  const corrected = previewContextCandidate(review, 0, { action: 'replace-first' });
  assert.equal(corrected.command.intent, 'add');
  assert.equal(corrected.command.item.label, 'yogur');
});

test('queries and unsupported phrases remain state identities and never produce implicit append commands', async () => {
  const list = await List.add({ name: 'Query and review' });
  const milk = await Item.add({ listId: list.id, label: 'leche' });
  const review = await prepareContextReview('¿ya hay leche?', list.id);
  const query = previewContextCandidate(review, 0);
  assert.equal(query.command.intent, 'query');
  assert.equal(query.stateIdentity, true);
  assert.deepEqual(query.targetChoices.map(({ itemId }) => itemId), [milk.id]);
  const queryDom = new FakeElement('div');
  renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container: queryDom, review });
  assert.match(queryDom.textContent, new RegExp(`Coincidencias \\(solo lectura\\): leche · ID ${milk.id}`));
  const unsupported = await prepareContextReview('borrá la lista', list.id);
  assert.equal(getContextPreviewCards(unsupported)[0].intent, 'review');
  assert.throws(() => previewContextCandidate(unsupported, 0), /revis|no está disponible/i);
  let commits = 0;
  const confirmation = createContextConfirmation(review, { commitFn: async () => { commits++; } });
  const result = await confirmation.confirm({ 0: { selected: true } });
  assert.equal(result.status, 'identity');
  assert.equal(commits, 0);
  assert.deepEqual((await Item.list(list.id)).map(({ id }) => id), [milk.id]);
  assert.equal(isAppendOnlyExtraction(unsupported.analysis), false, 'unsupported commands never fall through to legacy append');
  const deleteIntent = await prepareContextReview('borrá la leche', list.id);
  const deleteMeIntent = await prepareContextReview('borrame la leche', list.id);
  const question = await prepareContextReview('¿cuánta leche queda?', list.id);
  assert.equal(isAppendOnlyExtraction(deleteIntent.analysis), false);
  assert.equal(isAppendOnlyExtraction(deleteMeIntent.analysis), false);
  assert.equal(isAppendOnlyExtraction(question.analysis), false);
  const plainItems = await prepareContextReview('leche y pan', list.id);
  assert.equal(isAppendOnlyExtraction(plainItems.analysis), true, 'ordinary grocery extraction remains on the legacy append-only path');
});

test('price requirement replacement targets a selected assertion ID and preserves observation role and value', async () => {
  const list = await List.add({ name: 'Price assertion targets' });
  const milk = await Item.add({ listId: list.id, label: 'leche', attributes: { price: [
    { id: 'obs-a', role: 'observation', value: { type: 'price', amountMinor: 180000, currency: 'ARS', basis: { type: 'volume', unit: 'L', quantity: 1 }, observedAt: '2026-10-01T00:00:00.000Z' }, evidence: { source: 'ticket' } },
    { id: 'budget-a', role: 'requirement', value: { type: 'price', amountMinor: 200000, currency: 'ARS', basis: { type: 'volume', unit: 'L', quantity: 1 } }, evidence: { source: 'user' } },
  ] } });
  const review = await prepareContextReview('no más de 1900 ARS por litro para leche', list.id);
  const card = getContextPreviewCards(review)[0];
  assert.deepEqual(card.assertionChoices.map(({ assertionId, role }) => [assertionId, role]), [['budget-a', 'requirement']]);
  const result = previewContextCandidate(review, 0, { action: 'replace-assertion', targetItemId: milk.id, assertionId: 'budget-a' });
  assert.equal(result.command.assertionId, 'budget-a');
  assert.equal(result.command.replacement.role, undefined, 'replacement API must retain the selected immutable role');
  assert.equal(result.after.attributes.price.find(({ id }) => id === 'budget-a').value.amountMinor, 190000);
  assert.equal(result.after.attributes.price.find(({ id }) => id === 'obs-a').value.amountMinor, 180000);
  const container = new FakeElement('div');
  const rendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container, review });
  const action = container.find((node) => node.attributes['aria-label'] === 'Acción para leche');
  action.value = 'replace-assertion';
  action.dispatch('change');
  const formResolution = rendered.readResolutions()[0];
  assert.equal(formResolution.assertionId, 'budget-a');
  assert.equal(formResolution.targetItemId, milk.id);
  const confirmation = createContextConfirmation(review);
  assert.equal((await confirmation.confirm({ 0: formResolution })).status, 'committed');
  const persisted = (await Item.get(milk.id)).attributes.price;
  assert.equal(persisted.find(({ id }) => id === 'budget-a').value.amountMinor, 190000);
  assert.equal(persisted.find(({ id }) => id === 'budget-a').role, 'requirement');
  assert.equal(persisted.find(({ id }) => id === 'obs-a').value.amountMinor, 180000);
});

test('same assertion ID on two duplicate-label items stays scoped to the chosen item in the DOM and persisted command', async () => {
  const list = await List.add({ name: 'Scoped assertion identity' });
  const requirement = (amountMinor) => [{ id: 'budget-1', role: 'requirement', value: {
    type: 'price', amountMinor, currency: 'ARS', basis: { type: 'volume', unit: 'L', quantity: 1 },
  }, evidence: { source: 'user' } }];
  const first = await Item.add({ listId: list.id, label: 'leche', attributes: { price: requirement(220000) } });
  const second = await Item.add({ listId: list.id, label: 'leche', attributes: { price: requirement(210000) } });
  const review = await prepareContextReview('no más de 1900 ARS por litro para leche', list.id);
  const container = new FakeElement('div');
  const rendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container, review });
  const action = container.find((node) => node.attributes['aria-label'] === 'Acción para leche');
  action.value = 'replace-assertion';
  action.dispatch('change');
  const assertion = container.find((node) => node.attributes['aria-label'] === 'Afirmación de precio para leche');
  assert.deepEqual(assertion.children.slice(1).map(({ value }) => value), [`${first.id}::budget-1`, `${second.id}::budget-1`]);
  assertion.value = `${second.id}::budget-1`;
  assertion.dispatch('change');
  const resolution = rendered.readResolutions()[0];
  assert.equal(resolution.targetItemId, second.id);
  assert.equal(resolution.assertionId, 'budget-1');
  assert.equal((await createContextConfirmation(review).confirm({ 0: resolution })).status, 'committed');
  assert.equal((await Item.get(first.id)).attributes.price[0].value.amountMinor, 220000);
  assert.equal((await Item.get(second.id)).attributes.price[0].value.amountMinor, 190000);
  assert.equal((await Item.get(second.id)).attributes.price[0].role, 'requirement');
});

test('price with missing currency or observation context is review-only', async () => {
  const list = await List.add({ name: 'Incomplete price context' });
  const review = await prepareContextReview('la leche sale 2000 pesos por litro', list.id);
  assert.equal(getContextPreviewCards(review)[0].intent, 'update-attribute');
  assert.throws(() => previewContextCandidate(review, 0), /contexto|revis|moneda|observación/i);
});

test('explicit price fields create a typed observation only after currency, time, source, and target confirmation', async () => {
  const list = await List.add({ name: 'Price observation confirmation' });
  const milk = await Item.add({ listId: list.id, label: 'leche' });
  const review = await prepareContextReview('la leche sale 2000 pesos por litro', list.id, { audioId: 'capture-a' });
  const resolution = {
    selected: true, action: 'append-assertion', targetItemId: milk.id,
    priceCurrency: 'ARS', observedAt: '2026-10-29T12:00:00.000Z', evidenceSource: 'supermercado',
  };
  const preview = previewContextCandidate(review, 0, resolution);
  assert.equal(preview.after.attributes.price[0].role, 'observation');
  assert.deepEqual(preview.after.attributes.price[0].value, {
    type: 'price', amountMinor: 200000, currency: 'ARS', basis: { type: 'volume', unit: 'L', quantity: 1 },
    observedAt: '2026-10-29T12:00:00.000Z',
  });
  const confirmation = createContextConfirmation(review);
  assert.equal((await confirmation.confirm({ 0: resolution })).status, 'committed');
  const persisted = (await Item.get(milk.id)).attributes.price[0];
  assert.equal(persisted.evidence.source, 'supermercado');
  assert.equal(persisted.evidence.audioId, 'capture-a');
});

test('DOM price preview exposes editable amount, ISO currency, observation time, and evidence source', async () => {
  const list = await List.add({ name: 'Price fields UI' });
  const milk = await Item.add({ listId: list.id, label: 'leche' });
  const review = await prepareContextReview('la leche sale 2000 pesos por litro', list.id);
  const container = new FakeElement('div');
  const rendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container, review });
  const find = (label) => container.find((node) => node.attributes['aria-label'] === label);
  const action = find('Acción para leche');
  action.value = 'append-assertion';
  action.dispatch('change');
  find('Precio de leche').value = '2050.50';
  find('Precio de leche').dispatch('input');
  find('Moneda del precio de leche').value = 'ARS';
  find('Moneda del precio de leche').dispatch('change');
  find('Fecha y hora de observación para leche').value = '2026-10-29T12:00';
  find('Fecha y hora de observación para leche').dispatch('input');
  find('Fuente del precio para leche').value = 'supermercado';
  find('Fuente del precio para leche').dispatch('input');
  const resolution = rendered.readResolutions()[0];
  assert.equal(resolution.action, 'append-assertion');
  assert.equal(resolution.priceCurrency, 'ARS');
  assert.equal(resolution.priceAmount, '2050.50');
  assert.equal(resolution.observedAt, new Date('2026-10-29T12:00').toISOString());
  assert.equal(resolution.evidenceSource, 'supermercado');
  assert.doesNotMatch(container.textContent, /Indica dónde lo observaste/);
  assert.equal((await createContextConfirmation(review).confirm({ 0: resolution })).status, 'committed');
  const saved = (await Item.get(milk.id)).attributes.price[0];
  assert.equal(saved.value.amountMinor, 205050);
  assert.equal(saved.value.currency, 'ARS');
  assert.equal(saved.value.observedAt, resolution.observedAt);
  assert.equal(saved.evidence.source, 'supermercado');
});

test('price preview formats minor units and round-trips currency-specific fraction digits', async () => {
  const list = await List.add({ name: 'Currency precision' });
  const milk = await Item.add({ listId: list.id, label: 'leche', attributes: { price: [
    { id: 'yen-a', role: 'observation', value: { type: 'price', amountMinor: 2000, currency: 'JPY', basis: { type: 'volume', unit: 'L', quantity: 1 }, observedAt: '2026-10-29T12:00:00.000Z' }, evidence: { source: 'ticket' } },
    { id: 'dinar-a', role: 'observation', value: { type: 'price', amountMinor: 1234, currency: 'KWD', basis: { type: 'volume', unit: 'L', quantity: 1 }, observedAt: '2026-10-29T12:00:00.000Z' }, evidence: { source: 'ticket' } },
  ] } });
  const review = await prepareContextReview('no más de 2000 ARS por litro para leche', list.id);
  const container = new FakeElement('div');
  const rendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container, review });
  const copy = container.textContent;
  assert.doesNotMatch(copy, /200000 ARS/);
  assert.match(copy, /ARS.*2[.,]000/);
  assert.match(copy, /JPY.*2[.,]?000/);
  assert.match(copy, /KWD.*1[.,]234/);

  // A zero-fraction currency stores one integer per major unit.
  const yenReview = await prepareContextReview('la leche sale 2000 pesos por litro', list.id);
  const yenContainer = new FakeElement('div');
  const yenRendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container: yenContainer, review: yenReview });
  const find = (label) => yenContainer.find((node) => node.attributes['aria-label'] === label);
  find('Acción para leche').value = 'append-assertion';
  find('Acción para leche').dispatch('change');
  const yenCurrency = find('Moneda del precio de leche');
  assert.ok(yenCurrency.children.some(({ value }) => value === 'JPY'));
  yenCurrency.value = 'JPY';
  yenCurrency.dispatch('change');
  assert.equal(find('Precio de leche').step, '1');
  find('Precio de leche').value = '2000';
  find('Precio de leche').dispatch('input');
  find('Fecha y hora de observación para leche').value = '2026-10-29T12:00';
  find('Fecha y hora de observación para leche').dispatch('input');
  find('Fuente del precio para leche').value = 'supermercado';
  find('Fuente del precio para leche').dispatch('input');
  const yenResolution = yenRendered.readResolutions()[0];
  yenResolution.targetItemId = milk.id;
  assert.equal((await createContextConfirmation(yenReview).confirm({ 0: yenResolution })).status, 'committed');
  const persistedYen = (await Item.get(milk.id)).attributes.price.find(({ value }) => value.currency === 'JPY');
  assert.equal(persistedYen.value.amountMinor, 2000);
  assert.equal(persistedYen.value.currency, 'JPY');

  // A three-fraction currency preserves its thousandths in the same major/minor conversion.
  const dinarReview = await prepareContextReview('la leche sale 1 ARS por litro', list.id);
  const dinarContainer = new FakeElement('div');
  const dinarRendered = renderContextPreview({ document: { createElement: (tag) => new FakeElement(tag) }, container: dinarContainer, review: dinarReview });
  const findDinar = (label) => dinarContainer.find((node) => node.attributes['aria-label'] === label);
  findDinar('Acción para leche').value = 'append-assertion';
  findDinar('Acción para leche').dispatch('change');
  findDinar('Moneda del precio de leche').value = 'KWD';
  findDinar('Moneda del precio de leche').dispatch('change');
  assert.equal(findDinar('Precio de leche').step, '0.001');
  findDinar('Precio de leche').value = '1.234';
  findDinar('Precio de leche').dispatch('input');
  findDinar('Fecha y hora de observación para leche').value = '2026-10-29T12:00';
  findDinar('Fecha y hora de observación para leche').dispatch('input');
  findDinar('Fuente del precio para leche').value = 'supermercado';
  findDinar('Fuente del precio para leche').dispatch('input');
  const dinarResolution = dinarRendered.readResolutions()[0];
  dinarResolution.targetItemId = milk.id;
  assert.equal((await createContextConfirmation(dinarReview).confirm({ 0: dinarResolution })).status, 'committed');
  const persistedDinar = (await Item.get(milk.id)).attributes.price.find(({ value }) => value.currency === 'KWD');
  assert.equal(persistedDinar.value.amountMinor, 1234);
});

test('price display and conversion use ISO currency minor-unit digits rather than assuming two decimals', () => {
  assert.equal(currencyMinorDigits('ARS'), 2);
  assert.equal(currencyMinorDigits('JPY'), 0);
  assert.equal(currencyMinorDigits('KWD'), 3);
  assert.equal(amountToMinor('2000.50', 'ARS'), 200050);
  assert.equal(amountToMinor('2000', 'JPY'), 2000);
  assert.equal(amountToMinor('2000.5', 'JPY'), null);
  assert.equal(amountToMinor('1.234', 'KWD'), 1234);
  assert.match(formatMinorAmount(200050, 'ARS'), /2\.000,50/u);
  assert.match(formatMinorAmount(2000, 'JPY'), /2\.000/u);
  assert.doesNotMatch(formatMinorAmount(2000, 'JPY'), /,00/u);
  assert.match(formatMinorAmount(1234, 'KWD'), /1[.,]234/u);
});

test('confirmation cancel performs no writes and explicit confirmation commits exactly once', async () => {
  const list = await List.add({ name: 'Confirm context' });
  const review = await prepareContextReview('agregá pan', list.id);
  let writes = 0;
  const cancelled = createContextConfirmation(review, { commitFn: async () => { writes++; } });
  assert.equal(cancelled.cancel(), true);
  assert.equal((await cancelled.confirm({ 0: { selected: true } })).status, 'cancelled');
  assert.equal(writes, 0);

  const confirmed = createContextConfirmation(review, { commitFn: (payload) => { writes++; return commitCommands(payload); } });
  const result = await confirmed.confirm({ 0: { selected: true } });
  assert.equal(result.status, 'committed');
  assert.equal(writes, 1);
  assert.deepEqual((await Item.list(list.id)).map(({ label }) => label), ['pan']);
});

test('stale confirmation returns renewed analysis and never commits the stale proposal automatically', async () => {
  const list = await List.add({ name: 'Stale context' });
  const review = await prepareContextReview('agregá pan', list.id);
  await Item.add({ listId: list.id, id: 'changed', label: 'arroz' });
  let writes = 0;
  const confirmation = createContextConfirmation(review, {
    commitFn: (payload) => { writes++; return commitCommands(payload); },
  });
  const result = await confirmation.confirm({ 0: { selected: true } });
  assert.equal(result.status, 'stale');
  assert.equal(result.review.snapshot.version, 1);
  assert.equal(result.review.analysis.version, 1);
  assert.equal(writes, 1);
  assert.deepEqual((await Item.list(list.id)).map(({ label }) => label), ['arroz']);
});

test('confirmation passes explicit resolved commands through the reducer before commit', async () => {
  const list = await List.add({ name: 'Reducer confirmation' });
  await Item.add({ listId: list.id, id: 'milk', label: 'leche', quantity: 1, unit: 'litros' });
  const review = await prepareContextReview('otro kilo de leche', list.id);
  let calls = 0;
  const confirmation = createContextConfirmation(review, { commitFn: async () => { calls++; } });
  await assert.rejects(confirmation.confirm({ 0: { selected: true } }), /unidad|conversion|compatible/i);
  assert.equal(calls, 0);
  assert.deepEqual((await Item.list(list.id))[0].quantity, 1);
});

test('reload-required storage failure leaves confirmation pending and never reports commit success', async () => {
  const list = await List.add({ name: 'Blocked confirmation' });
  const review = await prepareContextReview('agregá pan', list.id);
  let attempts = 0;
  const confirmation = createContextConfirmation(review, {
    commitFn: async () => { attempts++; throw new ReloadRequiredError(); },
  });
  await assert.rejects(confirmation.confirm({ 0: { selected: true } }), ReloadRequiredError);
  assert.equal(confirmation.cancel(), true, 'a failed storage attempt stays recoverable and uncompleted');
  assert.equal(attempts, 1);
  assert.deepEqual(await Item.list(list.id), []);
});

test('confirmation form keeps a storage failure open and invokes the visible error path without false success', async () => {
  const listeners = new Set();
  const form = {
    addEventListener(type, fn) { if (type === 'submit') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'submit') listeners.delete(fn); },
    async submit() { const event = { preventDefault() {} }; await Promise.all([...listeners].map((fn) => fn(event))); },
  };
  const list = await List.add({ name: 'Form recoverable failure' });
  const review = await prepareContextReview('agregá pan', list.id);
  let success = 0;
  let failure = 0;
  const session = createContextConfirmation(review, { commitFn: async () => { throw new ReloadRequiredError(); } });
  const formSession = bindContextConfirmation({
    form, getConfirmation: () => session, getResolutions: () => ({ 0: { selected: true } }),
    onSuccess: () => { success++; }, onError: (error) => { if (error instanceof ReloadRequiredError) failure++; },
  });
  await form.submit();
  assert.equal(success, 0);
  assert.equal(failure, 1);
  assert.equal(listeners.size, 1, 'review submit stays available to retry after reload/recovery');
  assert.equal(formSession.cancel(), true);
  assert.deepEqual(await Item.list(list.id), []);
});

test('blocked schema upgrade holds contextual confirmation without success until storage resumes', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('listar');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  const oldRequest = indexedDB.open('listar', 1);
  oldRequest.onupgradeneeded = () => {
    const db = oldRequest.result;
    const lists = db.createObjectStore('lists', { keyPath: 'id' });
    lists.createIndex('order', 'order');
    lists.createIndex('name', 'name');
    const items = db.createObjectStore('items', { keyPath: 'id' });
    items.createIndex('listId', 'listId');
    items.createIndex('order', 'order');
    items.createIndex('done', 'done');
    const audio = db.createObjectStore('audio', { keyPath: 'id' });
    audio.createIndex('listId', 'listId');
    audio.createIndex('createdAt', 'createdAt');
    lists.put({ id: 'blocked-list', name: 'Bloqueo', emoji: '🛒', createdAt: 1, order: 1 });
  };
  const blocker = await new Promise((resolve, reject) => {
    oldRequest.onsuccess = () => resolve(oldRequest.result);
    oldRequest.onerror = () => reject(oldRequest.error);
  });
  const review = await prepareContextReview('agregá pan', 'blocked-list', {
    readSnapshotFn: async () => ({ listId: 'blocked-list', version: 0, items: [] }),
  });
  const listeners = new Set();
  const form = {
    addEventListener(type, fn) { if (type === 'submit') listeners.add(fn); },
    removeEventListener(type, fn) { if (type === 'submit') listeners.delete(fn); },
    async submit() { const event = { preventDefault() {} }; await Promise.all([...listeners].map((fn) => fn(event))); },
  };
  const states = [];
  let busy = false;
  let success = 0;
  let readyStatus;
  const unset = setUpgradeBlockedHandler((state) => {
    states.push(state.code);
    if (state.code === 'upgrade-ready') readyStatus = state;
  });
  const confirmation = createContextConfirmation(review);
  const formSession = bindContextConfirmation({
    form, getConfirmation: () => confirmation, getResolutions: () => ({ 0: { selected: true } }),
    onBusy: (value) => { busy = value; }, onSuccess: () => { success++; },
  });
  const pending = form.submit();
  for (let tries = 0; tries < 50 && !states.includes('blocked-upgrade'); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.deepEqual(states, ['blocked-upgrade']);
  assert.equal(busy, true);
  assert.equal(success, 0);
  assert.equal(listeners.size, 1, 'the preview is still open while the transaction cannot start');
  blocker.close();
  await pending;
  unset();
  formSession.cancel();
  assert.deepEqual(states, ['blocked-upgrade', 'upgrade-ready']);
  assert.equal(readyStatus.message, '');
  assert.equal(success, 1);
  assert.equal((await Item.list('blocked-list'))[0].label, 'pan');
});
