import type { Mission, Run } from './contracts.js';
import { atlasProducts } from './atlas.js';
import { ToolDispatcher } from './dispatcher.js';
import { Store } from './store.js';
import { PolicyError } from './policy.js';

export async function runAtlasDemo(store: Store, dispatcher: ToolDispatcher, mission: Mission, run: Run, baseUrl: string): Promise<void> {
  store.setMissionStatus(mission.id, 'running');
  try {
    for (const product of atlasProducts) {
      const destination = `${baseUrl}/atlas/product/${product.sku}?mission=${mission.id}`;
      await dispatcher.navigate(mission, run, { url: destination });
      const inspection = await dispatcher.inspect(mission, run, {});
      const quote = `${product.title}: ${product.specification}; ${product.availability.replace('_', ' ')} at $${(product.priceCents / 100).toFixed(2)}.`;
      const evidence = dispatcher.captureEvidence(mission, { quote }, inspection);
      dispatcher.upsertCandidate(mission, { retailer: 'Pepper Sandbox (local sandbox)', title: product.title, priceCents: product.priceCents, availability: product.availability, url: destination, score: product.score, notes: product.description, evidenceIds: [evidence.id] });
    }
    const winner = [...atlasProducts].sort((a, b) => b.score - a.score)[0];
    await dispatcher.navigate(mission, run, { url: `${baseUrl}/atlas/product/${winner.sku}?mission=${mission.id}` });
    const inspection = await dispatcher.inspect(mission, run, {});
    const add = inspection.elements.find((element) => /add to cart/i.test(element.label));
    if (!add) throw new Error('Pepper Sandbox page did not expose an Add to cart control.');
    await dispatcher.interact(mission, run, { snapshotId: inspection.snapshotId, targetId: add.id, kind: 'click', expected: 'Item added to cart' });
    const cart = store.cart(mission.id);
    if (!cart.some((line) => line.sku === winner.sku && line.quantity === 1)) throw new Error('Cart postcondition was not persisted.');
    store.setMissionStatus(mission.id, 'completed');
    store.updateRun(run.id, 'completed', `${winner.title} was selected from ${atlasProducts.length} evidence-backed offers and added to the Pepper Sandbox cart.`);
  } catch (error) {
    store.setMissionStatus(mission.id, 'failed'); store.updateRun(run.id, 'failed', error instanceof Error ? error.message : 'Demo failed'); throw error;
  }
}

export async function runAtlasConsentDemo(store: Store, dispatcher: ToolDispatcher, mission: Mission, run: Run, baseUrl: string): Promise<void> {
  store.setMissionStatus(mission.id, 'running');
  const winner = [...atlasProducts].sort((a, b) => b.score - a.score)[0];
  try {
    const productUrl = `${baseUrl}/atlas/product/${winner.sku}?mission=${mission.id}`;
    await dispatcher.navigate(mission, run, { url: productUrl });
    const product = await dispatcher.inspect(mission, run, {});
    const add = product.elements.find((element) => /add to cart/i.test(element.label));
    if (!add) throw new Error('Pepper Sandbox did not expose an Add to cart control.');
    await dispatcher.interact(mission, run, { snapshotId: product.snapshotId, targetId: add.id, kind: 'click', expected: 'Item added to cart' });

    const cartUrl = `${baseUrl}/atlas/cart?mission=${mission.id}`;
    await dispatcher.navigate(mission, run, { url: cartUrl });
    const cart = await dispatcher.inspect(mission, run, {});
    const checkout = cart.elements.find((element) => /proceed to checkout/i.test(element.label));
    if (!checkout) throw new Error('Pepper Sandbox did not expose a checkout control.');
    await dispatcher.interact(mission, run, { snapshotId: cart.snapshotId, targetId: checkout.id, kind: 'click', expected: 'Local checkout review' });

    const paymentUrl = `${baseUrl}/atlas/payment?mission=${mission.id}`;
    await dispatcher.navigate(mission, run, { url: paymentUrl });
    const payment = await dispatcher.inspect(mission, run, {});
    const confirm = payment.elements.find((element) => /confirm sandbox payment/i.test(element.label));
    if (!confirm) throw new Error('Pepper Sandbox did not expose a payment confirmation control.');
    await dispatcher.interact(mission, run, { snapshotId: payment.snapshotId, targetId: confirm.id, kind: 'click', expected: 'Sandbox payment confirmed' });
    if (!store.sandboxPayment(mission.id)) throw new Error('Sandbox payment postcondition was not persisted.');
    store.setMissionStatus(mission.id, 'completed');
    store.updateRun(run.id, 'completed', `${winner.title} completed the local consent demonstration with explicit checkout and payment approvals.`);
  } catch (error) {
    if (error instanceof PolicyError) {
      store.setMissionStatus(mission.id, 'needs_approval');
      store.updateRun(run.id, 'waiting_approval', error.message);
      return;
    }
    store.setMissionStatus(mission.id, 'failed');
    store.updateRun(run.id, 'failed', error instanceof Error ? error.message : 'Consent demonstration failed');
    throw error;
  }
}
