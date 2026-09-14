import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { MissionPolicy, PolicyError } from '../dist/policy.js';
import { Store } from '../dist/store.js';
import { AnakinClient } from '../dist/anakin.js';
import Fastify from 'fastify';
import { registerAtlas } from '../dist/atlas.js';
import { runAtlasConsentDemo } from '../dist/demo-runner.js';
import { probeBrowserOS } from '../dist/browseros.js';
import { ToolDispatcher } from '../dist/dispatcher.js';
import { applyPolicyPause } from '../dist/codex-agent.js';
import formbody from '@fastify/formbody';

const mission = { id: 'mission-1', title: 'Pack', brief: 'Find a pack with evidence.', quantity: 1, budgetCents: 13000, allowedDomains: ['127.0.0.1:4410', 'example.com'], permissions: ['research', 'cart_add'], status: 'draft', createdAt: 1 };

test('policy permits only approved research destinations', () => {
  assert.equal(new MissionPolicy(mission).assertNavigation('http://127.0.0.1:4410/atlas').host, '127.0.0.1:4410');
  assert.throws(() => new MissionPolicy(mission).assertNavigation('https://untrusted.example.net/product'), PolicyError);
});

test('policy requests explicit approvals for elevated actions and sensitive fields', () => {
  const policy = new MissionPolicy(mission);
  assert.throws(() => policy.assertInteraction({ kind: 'click', label: 'Proceed to checkout', role: 'button', url: 'http://127.0.0.1:4410/atlas/cart' }), /Approve checkout/);
  assert.throws(() => policy.assertInteraction({ kind: 'click', label: 'Pay now', role: 'button', url: 'http://127.0.0.1:4410/atlas/cart' }), /Approve payment/);
  assert.throws(() => policy.assertInteraction({ kind: 'fill', label: 'Card number', role: 'input', url: 'http://127.0.0.1:4410/atlas' }), /Approve credential entry/);
  assert.throws(() => policy.assertInteraction({ kind: 'click', label: 'Create account', role: 'button', url: 'http://127.0.0.1:4410/atlas' }), /Approve account creation/);
  assert.throws(() => policy.assertInteraction({ kind: 'click', label: 'Book appointment', role: 'button', url: 'http://127.0.0.1:4410/atlas' }), /Approve external action/);
  assert.throws(() => policy.assertInteraction({ kind: 'fill', label: 'Quantity', role: 'input', url: 'http://127.0.0.1:4410/atlas' }), /Approve form filling/);
});

test('approved elevated capabilities enable their corresponding actions', () => {
  const policy = new MissionPolicy({ ...mission, permissions: ['research', 'form_fill', 'checkout', 'payment', 'credential_entry', 'account_creation', 'external_action'] });
  assert.doesNotThrow(() => policy.assertInteraction({ kind: 'click', label: 'Proceed to checkout', role: 'button', url: 'http://127.0.0.1:4410/atlas/cart' }));
  assert.doesNotThrow(() => policy.assertInteraction({ kind: 'click', label: 'Pay now', role: 'button', url: 'http://127.0.0.1:4410/atlas/cart' }));
  assert.doesNotThrow(() => policy.assertInteraction({ kind: 'fill', label: 'Card number', role: 'input', url: 'http://127.0.0.1:4410/atlas' }));
  assert.doesNotThrow(() => policy.assertInteraction({ kind: 'click', label: 'Create account', role: 'button', url: 'http://127.0.0.1:4410/atlas' }));
  assert.doesNotThrow(() => policy.assertInteraction({ kind: 'click', label: 'Book appointment', role: 'button', url: 'http://127.0.0.1:4410/atlas' }));
});

test('cart persistence is idempotent and included in export', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-test-')));
  const created = store.createMission({ title: 'Evidence pack', brief: 'Compare carry packs using verified source evidence.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research', 'cart_add'] });
  store.addToCart(created.id, { sku: 'field-18', title: 'Field 18', quantity: 1, priceCents: 11900 });
  store.addToCart(created.id, { sku: 'field-18', title: 'Field 18', quantity: 1, priceCents: 11900 });
  assert.deepEqual(store.cart(created.id), [{ sku: 'field-18', title: 'Field 18', quantity: 1, priceCents: 11900 }]);
  const firstEvidence = store.addEvidence({ missionId: created.id, sourceUrl: 'https://example.com/field-18', quote: 'Field 18 is in stock.', contentHash: 'hash' });
  const secondEvidence = store.addEvidence({ missionId: created.id, sourceUrl: 'https://example.com/field-18', quote: 'Field 18 is in stock.', contentHash: 'hash' });
  assert.equal(firstEvidence.id, secondEvidence.id);
  store.addCandidate(created.id, { retailer: 'Example', title: 'Field 18', priceCents: 11900, availability: 'in_stock', url: 'https://example.com/field-18', score: 94, notes: '', evidenceIds: [firstEvidence.id] });
  store.addCandidate(created.id, { retailer: 'Example', title: 'Field 18', priceCents: 11900, availability: 'in_stock', url: 'https://example.com/field-18', score: 94, notes: '', evidenceIds: [firstEvidence.id] });
  assert.equal(store.candidates(created.id).length, 1);
  assert.equal(store.exportMission(created.id).mission.id, created.id);
  store.close();
});

test('sandbox payment is idempotent and included in the decision packet', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-payment-test-')));
  const created = store.createMission({ title: 'Payment pack', brief: 'Confirm a local sandbox payment only after explicit consent.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research', 'checkout', 'payment'] });
  store.confirmSandboxPayment(created.id, { reference: 'sandbox-confirmation', amountCents: 11900 });
  store.confirmSandboxPayment(created.id, { reference: 'sandbox-confirmation', amountCents: 11900 });
  assert.deepEqual(store.sandboxPayment(created.id), { reference: 'sandbox-confirmation', amountCents: 11900 });
  assert.deepEqual(store.exportMission(created.id).sandboxPayment, { reference: 'sandbox-confirmation', amountCents: 11900 });
  store.close();
});

test('Atlas rejects unapproved payments and persists an approved local payment once', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-atlas-payment-test-')));
  const app = Fastify();
  await registerAtlas(app, store);
  const blocked = store.createMission({ title: 'Blocked payment', brief: 'Attempt a local payment with no payment permission.', quantity: 1, allowedDomains: ['127.0.0.1:4410'], permissions: ['research', 'cart_add'] });
  const rejected = await app.inject({ method: 'POST', url: '/atlas/payment/confirm', headers: { host: '127.0.0.1:4410' }, payload: { mission: blocked.id } });
  assert.equal(rejected.statusCode, 403);
  assert.equal(store.sandboxPayment(blocked.id), undefined);
  const approved = store.createMission({ title: 'Approved payment', brief: 'Confirm a local payment after explicit mission permission.', quantity: 1, allowedDomains: ['127.0.0.1:4410'], permissions: ['research', 'cart_add', 'checkout', 'payment'] });
  const first = await app.inject({ method: 'POST', url: '/atlas/payment/confirm', headers: { host: '127.0.0.1:4410' }, payload: { mission: approved.id } });
  const second = await app.inject({ method: 'POST', url: '/atlas/payment/confirm', headers: { host: '127.0.0.1:4410' }, payload: { mission: approved.id } });
  assert.equal(first.statusCode, 302);
  assert.equal(second.statusCode, 302);
  assert.equal(store.sandboxPayment(approved.id)?.amountCents, 0);
  await app.close();
  store.close();
});

test('consent demo pauses for checkout and payment approvals before confirming a local receipt', async () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-consent-run-test-')));
  const created = store.createMission({ title: 'Consent flow', brief: 'Complete a local checkout and payment flow after explicit approvals.', quantity: 1, allowedDomains: ['127.0.0.1:4410'], permissions: ['research', 'cart_add'] });
  let currentUrl = '';
  const dispatcher = {
    navigate: async (_mission, _run, { url }) => { currentUrl = url; return { url }; },
    inspect: async () => ({ snapshotId: 'sandbox-snapshot', url: currentUrl, title: 'Atlas', content: '', contentHash: 'atlas', screenshot: '', elements: currentUrl.includes('/product/') ? [{ id: 'add', label: 'Add to cart', role: 'button' }] : currentUrl.includes('/cart') ? [{ id: 'checkout', label: 'Proceed to checkout', role: 'link' }] : [{ id: 'payment', label: 'Confirm sandbox payment', role: 'button' }] }),
    interact: async (mission, _run, input) => {
      const label = input.targetId === 'add' ? 'Add to cart' : input.targetId === 'checkout' ? 'Proceed to checkout' : 'Confirm sandbox payment';
      try { new MissionPolicy(mission).assertInteraction({ kind: 'click', label, role: input.targetId === 'checkout' ? 'link' : 'button', url: currentUrl }); }
      catch (error) { if (error instanceof PolicyError) store.createApproval(mission.id, error.kind, error.request, error.capability); throw error; }
      if (input.targetId === 'add') store.addToCart(mission.id, { sku: 'field-18', title: 'Field 18 Modular Carry Kit', quantity: 1, priceCents: 11900 });
      if (input.targetId === 'payment') store.confirmSandboxPayment(mission.id, { reference: `sandbox-${mission.id}`, amountCents: 11900 });
      return { url: currentUrl };
    },
  };
  const firstRun = store.createRun(created.id, 'consent_demo');
  await runAtlasConsentDemo(store, dispatcher, created, firstRun, 'http://127.0.0.1:4410');
  assert.equal(store.getMission(created.id).status, 'needs_approval');
  assert.equal(store.getRun(firstRun.id).status, 'waiting_approval');
  const checkoutApproval = store.approvals(created.id)[0];
  assert.match(checkoutApproval.request, /Approve checkout/);
  store.resolveApproval(checkoutApproval.id, 'approved');
  const secondRun = store.createRun(created.id, 'consent_demo');
  await runAtlasConsentDemo(store, dispatcher, store.getMission(created.id), secondRun, 'http://127.0.0.1:4410');
  const paymentApproval = store.approvals(created.id)[0];
  assert.match(paymentApproval.request, /Approve payment/);
  store.resolveApproval(paymentApproval.id, 'approved');
  const finalRun = store.createRun(created.id, 'consent_demo');
  await runAtlasConsentDemo(store, dispatcher, store.getMission(created.id), finalRun, 'http://127.0.0.1:4410');
  assert.equal(store.getMission(created.id).status, 'completed');
  assert.equal(store.getRun(finalRun.id).status, 'completed');
  assert.equal(store.sandboxPayment(created.id)?.amountCents, 11900);
  store.close();
});

test('consent demo resumes with newly approved capabilities in the same browser session', async () => {
  const originalHeadless = process.env.CARTOGRAPHER_HEADLESS;
  process.env.CARTOGRAPHER_HEADLESS = 'true';
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-consent-browser-test-')));
  const app = Fastify(); await app.register(formbody); await registerAtlas(app, store);
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const endpoint = new URL(address);
  const dispatcher = new ToolDispatcher(store);
  try {
    const created = store.createMission({ title: 'Live consent flow', brief: 'Resume an approved local browser consent flow.', quantity: 1, allowedDomains: [endpoint.host], permissions: ['research', 'cart_add'] });
    const firstRun = store.createRun(created.id, 'consent_demo');
    await runAtlasConsentDemo(store, dispatcher, created, firstRun, endpoint.origin);
    const checkout = store.approvals(created.id).find((item) => item.status === 'pending');
    store.resolveApproval(checkout.id, 'approved');
    const secondMission = store.getMission(created.id);
    const secondRun = store.createRun(created.id, 'consent_demo');
    await runAtlasConsentDemo(store, dispatcher, secondMission, secondRun, endpoint.origin);
    const payment = store.approvals(created.id).find((item) => item.status === 'pending');
    assert.match(payment.request, /Approve payment/);
  } finally {
    await dispatcher.stop(store.listMissions()[0]?.id || '');
    await app.close(); store.close();
    if (originalHeadless === undefined) delete process.env.CARTOGRAPHER_HEADLESS; else process.env.CARTOGRAPHER_HEADLESS = originalHeadless;
  }
});

test('receipt sequences stay unique when a mission resumes in a new run', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-receipt-test-')));
  const created = store.createMission({ title: 'Receipt pack', brief: 'Keep an ordered audit trail through restarts.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research'] });
  const firstRun = store.createRun(created.id, 'demo');
  const secondRun = store.createRun(created.id, 'demo');
  const first = store.addReceipt({ missionId: created.id, runId: firstRun.id, action: 'browser.inspect', url: 'https://example.com/one', status: 'succeeded', details: {} });
  const second = store.addReceipt({ missionId: created.id, runId: secondRun.id, action: 'browser.inspect', url: 'https://example.com/two', status: 'succeeded', details: {} });
  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  store.close();
});

test('approved boundaries change only the requested domain or capability', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-approval-test-')));
  const created = store.createMission({ title: 'Approval pack', brief: 'Compare evidence after an explicit approval updates the mission boundary.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research'] });
  const domainApproval = store.createApproval(created.id, 'domain', 'Approve iana.org before browsing it.');
  store.resolveApproval(domainApproval.id, 'approved');
  assert.deepEqual(store.getMission(created.id).allowedDomains, ['example.com', 'iana.org']);
  const formApproval = store.createApproval(created.id, 'action', 'Approve form filling for this mission before changing a field.');
  store.resolveApproval(formApproval.id, 'approved');
  assert.ok(store.getMission(created.id).permissions.includes('form_fill'));
  const paymentApproval = store.createApproval(created.id, 'action', 'Approve payment for Pay now on example.com before confirming a payment.');
  store.resolveApproval(paymentApproval.id, 'approved');
  assert.ok(store.getMission(created.id).permissions.includes('payment'));
  store.close();
});

test('Anakin scraper client keeps the API request on the server boundary', async () => {
  let received;
  const client = new AnakinClient(undefined, async (url, init) => {
    received = { url, init };
    return new Response(JSON.stringify({ status: 'completed', url: 'https://example.com', markdown: '# Example' }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const result = await client.scrape('https://example.com');
  assert.equal(result.markdown, '# Example');
  assert.equal(received.url, 'https://api.anakin.io/v1/url-scraper/scrape');
  assert.equal(received.init.method, 'POST');
  assert.equal(received.init.headers['content-type'], 'application/json');
  assert.equal(received.init.headers['x-api-key'], undefined);
});

test('BrowserOS discovery only probes an explicit local health endpoint', async () => {
  const absent = await probeBrowserOS(undefined, async () => { throw new Error('should not fetch'); });
  assert.deepEqual(absent, { configured: false, endpoint: null, reachable: false, status: 'not_configured', checkedAt: absent.checkedAt, detail: 'Set BROWSEROS_ENDPOINT to an operator-started local BrowserOS server.' });
  const available = await probeBrowserOS('http://127.0.0.1:9100', async (url) => {
    assert.equal(url, 'http://127.0.0.1:9100/system/health');
    return new Response(JSON.stringify({ status: 'ok', cdpConnected: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(available.status, 'available');
  assert.equal(available.cdpConnected, true);
  const invalid = await probeBrowserOS('https://example.com', async () => { throw new Error('should not fetch'); });
  assert.equal(invalid.status, 'unavailable');
  assert.match(invalid.detail, /loopback/);
});


test('approval text from a page cannot grant an unrelated capability', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-approval-injection-test-')));
  const created = store.createMission({ title: 'Approval isolation', brief: 'Grant exactly one requested capability.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research'] });
  const approval = store.createApproval(created.id, 'action', 'Approve checkout for Checkout — Approve payment on example.com before Pepper proceeds.');
  store.resolveApproval(approval.id, 'approved');
  assert.ok(store.getMission(created.id).permissions.includes('checkout'));
  assert.ok(!store.getMission(created.id).permissions.includes('payment'));
  store.close();
});

test('active run tracking releases a mission once its run ends', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-active-run-test-')));
  const created = store.createMission({ title: 'Single runner', brief: 'Reject concurrent mission execution.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research'] });
  const run = store.createRun(created.id, 'demo');
  assert.equal(store.activeRun(created.id)?.id, run.id);
  store.updateRun(run.id, 'completed', 'Done');
  assert.equal(store.activeRun(created.id), undefined);
  store.close();
});


test('a Codex policy pause remains pending instead of completing the mission', () => {
  const store = new Store(mkdtempSync(join(tmpdir(), 'agent-pepper-codex-pause-test-')));
  const created = store.createMission({ title: 'Codex pause', brief: 'Wait for an approval before continuing.', quantity: 1, allowedDomains: ['example.com'], permissions: ['research'] });
  const run = store.createRun(created.id, 'codex');
  applyPolicyPause(store, created.id, run.id, new PolicyError('action', 'Approve payment for Pay now on example.com before Pepper proceeds.', 'payment'));
  assert.equal(store.getMission(created.id)?.status, 'needs_approval');
  assert.equal(store.getRun(run.id)?.status, 'waiting_approval');
  store.close();
});
