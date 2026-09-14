import type { FastifyInstance } from 'fastify';
import type { Store } from './store.js';
import { MissionPolicy, PolicyError } from './policy.js';

export const atlasProducts = [
  { sku: 'trail-12', title: 'Trail 12 Technical Daypack', priceCents: 8900, availability: 'in_stock', score: 84, description: '12L weatherproof daypack with padded tablet sleeve and recycled ripstop shell.', specification: '12L · 540 g · 15-inch laptop sleeve · water-resistant' },
  { sku: 'field-18', title: 'Field 18 Modular Carry Kit', priceCents: 11900, availability: 'in_stock', score: 94, description: '18L modular carry kit with removable organizer, bottle pocket, and reinforced base.', specification: '18L · 780 g · modular organizer · 15-inch laptop sleeve' },
  { sku: 'summit-22', title: 'Summit 22 Expedition Pack', priceCents: 14900, availability: 'low_stock', score: 79, description: '22L load-hauling pack with ventilated back panel and trekking-pole loops.', specification: '22L · 980 g · ventilated frame · 16-inch laptop sleeve' },
] as const;

const shell = (title: string, body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>${title} · Pepper Sandbox</title><style>body{margin:0;background:#f3f2ee;color:#1e2728;font-family:ui-sans-serif,system-ui}header{background:#142d2e;color:#eef7f0;padding:22px 8%;display:flex;justify-content:space-between}main{max-width:980px;margin:48px auto;padding:0 24px}.tag{color:#9a5700;font-weight:700;text-transform:uppercase;letter-spacing:.08em;font-size:12px}.card{background:#fff;border:1px solid #d9ddd7;border-radius:18px;padding:28px;margin:18px 0;box-shadow:0 12px 30px #182e2310}.price{font-size:28px;font-weight:750}button{background:#135c52;color:white;border:0;border-radius:10px;padding:13px 18px;font-weight:700;font-size:15px;cursor:pointer}a{color:#135c52;font-weight:700;text-decoration:none}.muted{color:#64716c}</style></head><body><header><strong>PEPPER / SANDBOX</strong><span>Local demonstration storefront · <a style="color:#d6f2db" href="/atlas/cart?mission=${new URLSearchParams(body.match(/mission=([^&\"]+)/)?.[1] || '').get('mission') || ''}">View cart</a></span></header><main>${body}</main></body></html>`;
const money = (value: number) => `$${(value / 100).toFixed(2)}`;
const actionUrl = (host: string | undefined, path: string) => `http://${host || '127.0.0.1:4410'}${path}`;

function assertSandboxAction(store: Store, missionId: string, label: string, url: string): string | undefined {
  const mission = store.getMission(missionId);
  if (!mission) return 'Unknown mission.';
  try { new MissionPolicy(mission).assertInteraction({ kind: 'click', label, role: 'button', url }); return undefined; }
  catch (error) { return error instanceof PolicyError ? error.message : 'Sandbox action was not permitted.'; }
}

export async function registerAtlas(app: FastifyInstance, store: Store): Promise<void> {
  app.get('/atlas', async (request, reply) => {
    const mission = String((request.query as { mission?: string }).mission ?? '');
    const cards = atlasProducts.map((item) => `<article class="card"><div class="tag">${item.availability.replace('_', ' ')}</div><h2>${item.title}</h2><p>${item.description}</p><span class="price">${money(item.priceCents)}</span><p><a href="/atlas/product/${item.sku}?mission=${encodeURIComponent(mission)}">Review product evidence →</a></p></article>`).join('');
    return reply.type('text/html; charset=utf-8').send(shell('Pepper Sandbox', `<p class="tag">Local demonstration</p><h1>Durable carry systems for field work.</h1><p class="muted">This storefront exists so Agent Pepper can complete an auditable cart workflow without using a retail account.</p>${cards}`));
  });
  app.get('/atlas/product/:sku', async (request, reply) => {
    const item = atlasProducts.find((product) => product.sku === (request.params as { sku: string }).sku); if (!item) return reply.code(404).send('Not found');
    const mission = String((request.query as { mission?: string }).mission ?? '');
    return reply.type('text/html; charset=utf-8').send(shell(item.title, `<p><a href="/atlas?mission=${encodeURIComponent(mission)}">← Compare all products</a></p><article class="card"><div class="tag">${item.availability.replace('_', ' ')}</div><h1>${item.title}</h1><p>${item.description}</p><p><strong>Specification</strong><br>${item.specification}</p><p class="price">${money(item.priceCents)}</p><form method="post" action="/atlas/cart/add"><input type="hidden" name="mission" value="${mission}"><input type="hidden" name="sku" value="${item.sku}"><button type="submit">Add to cart</button></form></article>`));
  });
  app.post('/atlas/cart/add', async (request, reply) => {
    const body = request.body as { mission?: string; sku?: string }; const item = atlasProducts.find((product) => product.sku === body.sku);
    if (!body.mission || !item) return reply.code(400).send('Missing cart context');
    const blocked = assertSandboxAction(store, body.mission, 'Add to cart', actionUrl(request.headers.host, `/atlas/product/${item.sku}?mission=${encodeURIComponent(body.mission)}`));
    if (blocked) return reply.code(403).send(blocked);
    store.addToCart(body.mission, { sku: item.sku, title: item.title, quantity: 1, priceCents: item.priceCents });
    return reply.redirect(`/atlas/cart?mission=${encodeURIComponent(body.mission)}&added=${encodeURIComponent(item.sku)}`);
  });
  app.get('/atlas/cart', async (request, reply) => {
    const query = request.query as { mission?: string; added?: string }; const cart = query.mission ? store.cart(query.mission) : [];
    const rows = cart.length ? cart.map((line) => `<li><strong>${line.title}</strong> · Qty ${line.quantity} · ${money(line.priceCents * line.quantity)}</li>`).join('') : '<li>Your cart is empty.</li>';
    const total = cart.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    const checkout = cart.length ? `<p><a href="/atlas/checkout?mission=${encodeURIComponent(query.mission || '')}">Proceed to checkout →</a></p>` : '';
    return reply.type('text/html; charset=utf-8').send(shell('Cart', `<p class="tag">Cart receipt</p><h1>${query.added ? 'Item added to cart' : 'Your cart'}</h1><article class="card"><ul>${rows}</ul><p class="price">Total ${money(total)}</p>${checkout}<p class="muted">This is a local consent demonstration. No retailer, payment provider, or real charge is involved.</p></article>`));
  });
  app.get('/atlas/checkout', async (request, reply) => {
    const mission = String((request.query as { mission?: string }).mission ?? '');
    const cart = mission ? store.cart(mission) : [];
    const total = cart.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    return reply.type('text/html; charset=utf-8').send(shell('Checkout', `<p class="tag">Explicit approval required</p><h1>Local checkout review</h1><article class="card"><p>${cart.length} item${cart.length === 1 ? '' : 's'} · ${money(total)}</p><p><a href="/atlas/payment?mission=${encodeURIComponent(mission)}">Continue to payment approval →</a></p><p class="muted">The agent reaches this page only after checkout permission is granted.</p></article>`));
  });
  app.get('/atlas/payment', async (request, reply) => {
    const query = request.query as { mission?: string; confirmed?: string }; const mission = String(query.mission ?? '');
    const cart = mission ? store.cart(mission) : [];
    const total = cart.reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    const confirmed = query.confirmed === '1';
    return reply.type('text/html; charset=utf-8').send(shell('Payment approval', `<p class="tag">Local sandbox only</p><h1>${confirmed ? 'Sandbox payment confirmed' : 'Payment confirmation'}</h1><article class="card"><p class="price">Sandbox total ${money(total)}</p>${confirmed ? '<p>Receipt recorded locally. No retailer or payment provider was contacted.</p>' : '<form method="post" action="/atlas/payment/confirm"><input type="hidden" name="mission" value="' + mission + '"><button type="submit">Confirm sandbox payment</button></form>'}<p class="muted">No card details are requested, stored, or sent anywhere.</p></article>`));
  });
  app.post('/atlas/payment/confirm', async (request, reply) => {
    const body = request.body as { mission?: string }; if (!body.mission) return reply.code(400).send('Missing payment context');
    const blocked = assertSandboxAction(store, body.mission, 'Confirm sandbox payment', actionUrl(request.headers.host, `/atlas/payment?mission=${encodeURIComponent(body.mission)}`));
    if (blocked) return reply.code(403).send(blocked);
    const total = store.cart(body.mission).reduce((sum, line) => sum + line.priceCents * line.quantity, 0);
    store.confirmSandboxPayment(body.mission, { reference: `sandbox-${body.mission}`, amountCents: total });
    return reply.redirect(`/atlas/payment?mission=${encodeURIComponent(body.mission)}&confirmed=1`);
  });
}
