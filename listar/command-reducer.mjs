// Purpose: apply explicitly confirmed Listar commands to an in-memory snapshot.
// Responsibilities: validate command identity, quantities, units and typed attributes before returning a new state.
// Rationale: analysis is only a proposal; this pure boundary keeps invalid batches from changing persisted state.

import { validateItemAttributes } from './db.js';
import { isSupportedQuantityUnit } from './splitter.js';

const UNIT_FAMILIES = new Map([
  ['l', 'litro'], ['litro', 'litro'], ['litros', 'litro'],
  ['kg', 'kilo'], ['kilo', 'kilo'], ['kilos', 'kilo'],
  ['g', 'gramo'], ['gramo', 'gramo'], ['gramos', 'gramo'],
  ['ml', 'mililitro'], ['mililitro', 'mililitro'], ['mililitros', 'mililitro'],
  ['mg', 'miligramo'], ['miligramo', 'miligramo'], ['miligramos', 'miligramo'],
  ['metro', 'metro'], ['metros', 'metro'], ['centimetro', 'centimetro'], ['centimetros', 'centimetro'],
  ['milimetro', 'milimetro'], ['milimetros', 'milimetro'], ['tonelada', 'tonelada'], ['toneladas', 'tonelada'],
  ['libra', 'libra'], ['libras', 'libra'], ['onza', 'onza'], ['onzas', 'onza'],
  ['docena', 'docena'], ['docenas', 'docena'],
  ['paquete', 'paquete'], ['paquetes', 'paquete'],
  ['caja', 'caja'], ['cajas', 'caja'],
  ['lata', 'lata'], ['latas', 'lata'],
  ['botella', 'botella'], ['botellas', 'botella'],
  ['bolsa', 'bolsa'], ['bolsas', 'bolsa'], ['manojo', 'manojo'], ['manojos', 'manojo'],
  ['mano', 'mano'], ['manos', 'mano'], ['punado', 'punado'], ['punados', 'punado'],
  ['hora', 'hora'], ['horas', 'hora'], ['dia', 'dia'], ['dias', 'dia'],
  ['documento', 'documento'], ['documentos', 'documento'],
  ['unidad', 'unidad'], ['unidades', 'unidad'],
  ['pieza', 'pieza'], ['piezas', 'pieza'], ['pza', 'pieza'], ['pzas', 'pieza'],
]);

function fail(message) {
  throw new TypeError(message);
}

function cloneData(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function validSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || typeof snapshot.listId !== 'string' || !snapshot.listId.trim() ||
      !Number.isInteger(snapshot.version) || snapshot.version < 0 || !Array.isArray(snapshot.items)) {
    fail('A command reducer needs a listId, non-negative version, and item snapshot');
  }
  const ids = new Set();
  for (const item of snapshot.items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id)) {
      fail('Snapshot items need unique stable IDs');
    }
    if (item.listId != null && item.listId !== snapshot.listId) fail(`Item ${item.id} belongs to another list`);
    ids.add(item.id);
  }
}

function requireItem(items, id) {
  if (typeof id !== 'string' || !id.trim()) fail('A command needs an explicit targetItemId');
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) fail(`Target item not found: ${id}`);
  return { item: items[index], index };
}

function validateQuantity(quantity, unit, { required = true } = {}) {
  if (quantity == null && !required) {
    if (unit != null) fail('A quantity unit cannot exist without a quantity');
    return;
  }
  if (!Number.isFinite(quantity) || quantity <= 0) fail('Quantity must be a positive finite number');
  if (unit != null && !isSupportedQuantityUnit(unit)) fail(`Unsupported quantity unit: ${unit}`);
}

function unitFamily(unit) {
  if (unit == null || unit === '') return null;
  const normalized = String(unit).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
  return UNIT_FAMILIES.get(normalized) ?? normalized;
}

function assertCompatibleUnits(previous, next) {
  if (unitFamily(previous) !== unitFamily(next)) fail('Incompatible units need review or an explicit conversion');
}

function cloneAttributes(item) {
  return Object.fromEntries(Object.entries(item.attributes ?? {}).map(([key, assertions]) => [key, [...assertions]]));
}

function updateAttribute(item, command) {
  const { operation, key } = command;
  if (typeof key !== 'string' || !key.trim() || key !== key.trim()) fail('Attribute key must be a non-empty trimmed string');
  const attributes = cloneAttributes(item);
  const assertions = attributes[key] ?? [];
  if (operation === 'append') {
    const addition = command.assertion;
    if (!addition || typeof addition.id !== 'string' || !addition.id.trim()) fail('Append requires an assertion with a fresh immutable ID');
    if (Object.values(attributes).some((values) => values.some(({ id }) => id === addition.id))) {
      fail(`Duplicate assertion ID: ${addition.id}`);
    }
    attributes[key] = [...assertions, cloneData(addition)];
  } else if (operation === 'replace') {
    const id = command.assertionId;
    const index = assertions.findIndex((entry) => entry.id === id);
    if (index < 0) fail(`Assertion not found: ${key}/${id}`);
    const replacement = command.replacement;
    const current = assertions[index];
    if (!replacement || typeof replacement !== 'object') fail('Replace requires value and evidence');
    if (Object.hasOwn(replacement, 'id') && replacement.id !== current.id) fail('Assertion ID is immutable');
    if (Object.hasOwn(replacement, 'role') && replacement.role !== current.role) fail('Assertion role is immutable');
    if (!Object.hasOwn(replacement, 'value') || !Object.hasOwn(replacement, 'evidence')) fail('Replace requires value and evidence');
    assertions[index] = { ...current, value: cloneData(replacement.value), evidence: cloneData(replacement.evidence) };
    attributes[key] = assertions;
  } else if (operation === 'remove') {
    const id = command.assertionId;
    const index = assertions.findIndex((entry) => entry.id === id);
    if (index < 0) fail(`Assertion not found: ${key}/${id}`);
    assertions.splice(index, 1);
    if (assertions.length) attributes[key] = assertions;
    else delete attributes[key];
  } else {
    fail(`Unsupported attribute operation: ${operation}`);
  }
  if (Object.keys(attributes).length) validateItemAttributes(attributes);
  return Object.keys(attributes).length ? attributes : undefined;
}

function applyOne(state, items, command) {
  if (!command || typeof command !== 'object' || Array.isArray(command)) fail('Commands must be objects');
  if (command.intent === 'query' || command.intent === 'noop') return items;

  if (command.intent === 'add') {
    const input = command.item;
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('Add requires a complete item record');
    if (typeof input.id !== 'string' || !input.id.trim()) fail('Added items need a stable ID');
    if (items.some(({ id }) => id === input.id)) fail(`Duplicate item ID: ${input.id}`);
    if (input.listId != null && input.listId !== state.listId) fail('Added item belongs to another list');
    if (typeof input.label !== 'string' || !input.label.trim()) fail('Added items need a non-empty label');
    validateQuantity(input.quantity, input.unit, { required: input.quantity !== undefined });
    const item = { ...cloneData(input), listId: state.listId };
    if (!Object.hasOwn(item, 'text')) item.text = input.label;
    if (Object.hasOwn(item, 'attributes')) validateItemAttributes(item.attributes);
    return [...items, item];
  }

  if (command.intent === 'remove') {
    const { index } = requireItem(items, command.targetItemId);
    return items.filter((_, currentIndex) => currentIndex !== index);
  }

  if (command.intent === 'set' || command.intent === 'increment') {
    const { item, index } = requireItem(items, command.targetItemId);
    validateQuantity(command.quantity, command.unit);
    if (item.unit != null && !isSupportedQuantityUnit(item.unit)) fail(`Unsupported existing quantity unit: ${item.unit}`);
    const nextUnit = command.unit ?? item.unit;
    if (item.quantity !== undefined) {
      validateQuantity(item.quantity, item.unit);
      assertCompatibleUnits(item.unit, nextUnit);
    }
    if (command.intent === 'increment' && item.quantity === undefined) {
      fail('Increment needs an existing quantity baseline');
    }
    const quantity = command.intent === 'increment' ? item.quantity + command.quantity : command.quantity;
    validateQuantity(quantity, nextUnit);
    const updated = { ...item, quantity };
    if (nextUnit === undefined) delete updated.unit;
    else updated.unit = nextUnit;
    const result = [...items];
    result[index] = updated;
    return result;
  }

  if (command.intent === 'update-attribute') {
    const { item, index } = requireItem(items, command.targetItemId);
    const attributes = updateAttribute(item, command);
    const updated = { ...item };
    if (attributes) updated.attributes = attributes;
    else delete updated.attributes;
    const result = [...items];
    result[index] = updated;
    return result;
  }

  fail(`Unsupported command intent: ${command.intent}`);
}

/** Apply confirmed commands to a coherent snapshot. Throws without mutation when any command is invalid. */
export function applyCommands(snapshot, commands) {
  validSnapshot(snapshot);
  if (!Array.isArray(commands)) fail('Commands must be provided as an array');
  if (commands.length === 0 || commands.every((command) => command?.intent === 'query' || command?.intent === 'noop')) {
    return snapshot;
  }

  const state = { ...snapshot };
  let items = snapshot.items;
  for (const command of commands) items = applyOne(state, items, command);
  return { ...state, items };
}
