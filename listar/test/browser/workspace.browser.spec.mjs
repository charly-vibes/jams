// Purpose: prove the implemented checklist behaviors in a real browser (chromium), beyond node/fake-DOM evidence.
// Responsibilities: exercise typing capture, inline batch confirmation, keyboard focus return,
//   filtered-view receipts, durable intake recovery across a real reload, and two-tab stale edits.
// Rationale: IndexedDB durability, real focus semantics, and cross-tab contention cannot be
//   demonstrated by injected fakes; transcription itself is gated on jams-0rt.1 device evidence.
// Isolation: each test gets a fresh browser context (clean IndexedDB/caches); no deleteDatabase
//   races against db.js pooled connections.
import { test, expect } from '@playwright/test';

async function openFresh(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/index.html');
  return { context, page };
}

test('A01 typing captures one literal unassigned item, durable in real IndexedDB', async ({ browser }) => {
  const { context, page } = await openFresh(browser);
  await page.fill('#quick-capture-input', 'pan');
  await page.press('#quick-capture-input', 'Enter');
  await expect(page.locator('#quick-items .item-row')).toHaveCount(1);
  await expect(page.locator('#capture-receipt')).toContainText('Guardado en Pendientes');
  const stored = await readStore(page, 'listar-workspace', 'items');
  expect(stored.map((item) => item.label)).toEqual(['pan']);
  await context.close();
});

test('A02 multiline draft confirms one atomic batch through the real UI', async ({ browser }) => {
  const { context, page } = await openFresh(browser);
  // Real paste path: an <input> cannot carry newlines, so the app intercepts
  // multiline paste into a reviewable draft (demonstrated defect fix).
  await page.evaluate(() => {
    const input = document.querySelector('#quick-capture-input');
    const data = new DataTransfer();
    data.setData('text/plain', 'leche\npan\nhuevos');
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#draft-card')).toBeVisible();
  await expect(page.locator('#draft-confirm')).toHaveText(/Agregar 3/);
  await page.click('#draft-confirm');
  await expect(page.locator('#quick-items .item-row')).toHaveCount(3);
  const stored = await readStore(page, 'listar-workspace', 'items');
  expect(stored.length).toBe(3);
  await context.close();
});

test('keyboard editing: Escape returns real focus to the row label and Enter saves', async ({ browser }) => {
  const { context, page } = await openFresh(browser);
  await page.fill('#quick-capture-input', 'pan');
  await page.press('#quick-capture-input', 'Enter');
  await page.locator('.row-label').first().click();
  await expect(page.locator('.item-editing')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.item-editing')).toHaveCount(0);
  const focusedId = await page.evaluate(() => document.activeElement?.id ?? '');
  expect(focusedId).toMatch(/^row-label-/);
  await page.locator('.row-label').first().click();
  await page.fill('.row-edit-input', 'pan integral');
  await page.keyboard.press('Enter');
  await expect(page.locator('#quick-items')).toContainText('pan integral');
  await context.close();
});

test('A07 capture from Completados creates a pending item with a Ver en Pendientes receipt', async ({ browser }) => {
  const { context, page } = await openFresh(browser);
  await page.selectOption('#view-selector', 'completados');
  await page.fill('#quick-capture-input', 'leche');
  await page.press('#quick-capture-input', 'Enter');
  await expect(page.locator('#capture-receipt')).toContainText('Guardado en Pendientes');
  await expect(page.locator('#receipt-goto')).toBeVisible();
  await page.click('#receipt-goto');
  await expect.poll(() => page.inputValue('#view-selector'), { timeout: 5000 }).toBe('pendientes');
  await expect(page.locator('#quick-items .item-row')).toHaveCount(1);
  await context.close();
});

test('A16 durable intake survives a real reload; a committed intake finishes cleanup with zero duplicates', async ({ browser }) => {
  const { context, page } = await openFresh(browser);
  await page.evaluate(async () => {
    const cache = await caches.open('listar-shared-audio-v1');
    await cache.put(new URL('./__shared_audio__/tok-reload', location.href).href,
      new Response(new Blob(['audio-bytes'], { type: 'audio/webm' })));
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('listar');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('intakes', 'readwrite');
      tx.objectStore('intakes').put({ token: 'tok-reload', createdAt: 1, status: 'pending' });
      tx.objectStore('intakes').put({ token: 'tok-committed', createdAt: 2, status: 'committed', operationId: 'op-done' });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    const workspace = await new Promise((resolve, reject) => {
      const request = indexedDB.open('listar-workspace');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = workspace.transaction(['meta', 'items', 'operations'], 'readwrite');
      tx.objectStore('items').put({ id: 'op-done:item:0', label: 'Pan', text: 'pan', done: false, order: 1 });
      tx.objectStore('operations').put({ id: 'op-done', payload: [{ label: 'Pan' }], items: [] });
      const metaRequest = tx.objectStore('meta').get('revision');
      metaRequest.onsuccess = () => tx.objectStore('meta').put({ key: 'revision', value: (metaRequest.result?.value ?? 0) + 1 });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    workspace.close();
  });
  await page.reload({ waitUntil: 'load' });
  await expect(page.locator('#intake-card')).toBeVisible();
  await expect(page.locator('#intake-summary')).toContainText('1 audio');
  const tokens = (await readStore(page, 'listar', 'intakes')).map((entry) => entry.token);
  expect(tokens).toEqual(['tok-reload']);
  const items = await readStore(page, 'listar-workspace', 'items');
  expect(items.length).toBe(1);
  await expect(page.locator('#quick-items .item-row')).toHaveCount(1);
  await context.close();
});

test('A13 two tabs: editing from a stale revision is rejected, keeps input, and never overwrites newer work', async ({ browser }) => {
  const { context, page } = await openFresh(browser);
  await page.fill('#quick-capture-input', 'leche');
  await page.press('#quick-capture-input', 'Enter');
  await expect(page.locator('#quick-items .item-row')).toHaveCount(1);

  const tabB = await context.newPage();
  await tabB.goto('/index.html');
  await expect(tabB.locator('#quick-items .item-row')).toHaveCount(1);

  // B opens the editor (its snapshot is fresh at this point: revision R).
  await tabB.locator('.row-label').first().click();
  await tabB.fill('.row-edit-input', 'Leche entera');

  // A writes again WHILE B's editor holds revision R; B's guard revision is now stale.
  await page.fill('#quick-capture-input', 'pan');
  await page.press('#quick-capture-input', 'Enter');
  await expect(page.locator('#quick-items .item-row')).toHaveCount(2);

  await tabB.keyboard.press('Enter');
  await expect(tabB.locator('#app-status')).toContainText('No se pudo guardar');
  await expect(tabB.locator('.item-editing')).toBeVisible();
  await expect(tabB.locator('.row-edit-input')).toHaveValue('Leche entera');

  // Neither tab lost data; A's newer capture survived; B's stale write never landed.
  const labels = (await readStore(page, 'listar-workspace', 'items')).map((item) => item.label);
  expect(labels.sort()).toEqual(['leche', 'pan']);
  expect(labels).not.toContain('Leche entera');
  await tabB.close();
  await context.close();
});

async function readStore(page, dbName, store) {
  return page.evaluate(async ({ dbName, store }) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const all = await new Promise((resolve, reject) => {
      const request = db.transaction(store, 'readonly').objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return all;
  }, { dbName, store });
}
