// Purpose: execute the accessibility helpers that keep keyboard and focus behavior testable outside a browser.
// Responsibilities: cover Enter/Escape key action mapping and focus-origin restoration through a fake document.
// Rationale: save/cancel with keyboard and focus returning to the originating control are contract behaviors;
//   they must be proven with executable checks, not only source strings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { keyAction, createFocusKeeper } from '../a11y.mjs';

function fakeDocument(elements, initialId = null) {
  let activeElement = elements[initialId ?? ''] ?? null;
  return {
    get activeElement() { return activeElement; },
    getElementById: (id) => elements[id] ?? null,
    setActive(id) { activeElement = elements[id] ?? null; },
  };
}

test('keyAction maps Enter to save, Escape to cancel, and ignores other keys', () => {
  assert.equal(keyAction({ key: 'Enter' }), 'save');
  assert.equal(keyAction({ key: 'Escape' }), 'cancel');
  assert.equal(keyAction({ key: 'a' }), null);
  assert.equal(keyAction({ key: 'Tab' }), null);
  assert.equal(keyAction({}), null);
});

test('focus keeper restores the same element id after a re-render', () => {
  const origin = { id: 'row-label-cap-1', focused: 0, focus() { this.focused += 1; } };
  const doc = fakeDocument({ 'row-label-cap-1': origin }, 'row-label-cap-1');
  const keeper = createFocusKeeper(() => doc);
  keeper.save();
  doc.setActive('');
  assert.equal(keeper.restore(), true);
  assert.equal(origin.focused, 1);
  // Restoring twice does not double-focus; the origin is consumed.
  assert.equal(keeper.restore(), false);
  assert.equal(origin.focused, 1);
});

test('focus keeper degrades to a no-op when the origin or target is missing', () => {
  const doc = fakeDocument({}, null);
  const keeper = createFocusKeeper(() => doc);
  keeper.save();
  assert.equal(keeper.restore(), false);

  const other = { id: 'gone-later', focus() {} };
  const elements = { 'gone-later': other };
  const doc2 = fakeDocument(elements, 'gone-later');
  const keeper2 = createFocusKeeper(() => doc2);
  keeper2.save();
  delete elements['gone-later'];
  doc2.setActive('');
  assert.equal(keeper2.restore(), false);
});
