import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const outputDir = join(root, 'videos', 'agent-pepper-launch', 'source-footage');
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  recordVideo: { dir: outputDir, size: { width: 1920, height: 1080 } },
});
const page = await context.newPage();

await page.addInitScript(() => {
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    const label = document.createElement('div');
    label.id = 'demo-label';
    document.documentElement.append(cursor, label);
  });
});

async function installDemoChrome() {
  await page.addStyleTag({ content: `
    #demo-cursor { position: fixed; z-index: 2147483647; width: 22px; height: 22px; border-radius: 999px; pointer-events: none; left: 80px; top: 80px; transform: translate(-50%,-50%); border: 3px solid #d7ff52; box-shadow: 0 0 0 8px rgba(215,255,82,.2), 0 8px 32px rgba(0,0,0,.5); transition: left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1), transform .18s ease; }
    #demo-cursor::after { content: ''; position: absolute; inset: 6px; border-radius: inherit; background: #d7ff52; }
    #demo-label { position: fixed; z-index: 2147483646; opacity: 0; padding: 9px 13px; color: #111; background: #d7ff52; border-radius: 7px; font: 700 13px/1.1 'DM Sans', sans-serif; letter-spacing: .02em; pointer-events: none; box-shadow: 0 14px 40px rgba(0,0,0,.28); transition: opacity .2s ease, left .55s cubic-bezier(.2,.8,.2,1), top .55s cubic-bezier(.2,.8,.2,1); }
    .demo-focus { position: relative !important; z-index: 2147483645 !important; outline: 3px solid #d7ff52 !important; outline-offset: 5px !important; box-shadow: 0 0 0 9999px rgba(5,8,8,.44), 0 0 48px rgba(215,255,82,.28) !important; transition: outline .2s ease, box-shadow .2s ease !important; }
  ` });
}

async function focus(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Cannot frame ${label}`);
  await page.evaluate(({ x, y, label }) => {
    document.querySelectorAll('.demo-focus').forEach((node) => node.classList.remove('demo-focus'));
    const cursor = document.querySelector('#demo-cursor');
    const tag = document.querySelector('#demo-label');
    cursor.style.left = `${x}px`; cursor.style.top = `${y}px`; cursor.style.transform = 'translate(-50%,-50%) scale(1)';
    tag.textContent = label; tag.style.left = `${Math.min(x + 24, innerWidth - 260)}px`; tag.style.top = `${Math.min(y + 24, innerHeight - 60)}px`; tag.style.opacity = '1';
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2, label });
  await locator.evaluate((node) => node.classList.add('demo-focus'));
  await page.waitForTimeout(950);
}

async function click(locator, label) {
  await focus(locator, label);
  await page.evaluate(() => { const cursor = document.querySelector('#demo-cursor'); cursor.style.transform = 'translate(-50%,-50%) scale(.72)'; });
  await locator.click();
  await page.waitForTimeout(450);
  await installDemoChrome();
}

async function fill(locator, value, label) {
  await focus(locator, label);
  await locator.fill(value);
  await page.waitForTimeout(550);
}

try {
  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' });
  await installDemoChrome();
  await page.waitForTimeout(1800);

  await focus(page.getByRole('heading', { name: /Agent Pepper maps/i }), 'A browser agent built for real work');
  await page.waitForTimeout(1300);
  await click(page.getByRole('button', { name: /Start a mission/i }), 'Start with a bounded mission');

  await fill(page.getByLabel('Mission title'), 'Live market intelligence', 'Name the mission');
  await fill(page.getByLabel('What should Agent Pepper prove?'), 'Read a live public source, capture durable evidence, and produce a decision-ready audit trail.', 'Define the result');
  await fill(page.getByLabel('Approved domains'), 'example.com', 'Approve the destination');
  await click(page.getByRole('button', { name: 'Create mission', exact: true }), 'Create the mission');
  await page.getByText('MISSION READY').waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForTimeout(1200);

  await fill(page.getByLabel('Public URL to research'), 'https://example.com', 'Send a live source to Anakin');
  await click(page.getByRole('button', { name: 'Read', exact: true }), 'Capture live evidence');
  await page.getByText('LIVE SOURCE CAPTURED').waitFor({ state: 'visible', timeout: 40_000 });
  await page.waitForTimeout(900);
  await focus(page.getByText('Evidence ledger', { exact: true }).last(), 'Evidence stays attached');
  await page.waitForTimeout(1500);
  await focus(page.getByRole('link', { name: 'Decision packet' }), 'Export the full audit trail');
  await page.waitForTimeout(1200);

  await click(page.getByRole('button', { name: 'Consent demo', exact: true }).first(), 'Run the consent workflow');
  await page.getByText('Approval needed').first().waitFor({ state: 'visible', timeout: 40_000 });
  await page.waitForTimeout(900);
  await focus(page.getByText(/Approve checkout for/i).last(), 'Pepper pauses before checkout');
  await click(page.getByRole('button', { name: 'Approve', exact: true }).last(), 'Grant checkout permission');
  await click(page.getByRole('button', { name: 'Consent demo', exact: true }).first(), 'Resume safely');
  await page.getByText(/Approve payment for/i).last().waitFor({ state: 'visible', timeout: 40_000 });
  await focus(page.getByText(/Approve payment for/i).last(), 'Payment needs its own approval');
  await click(page.getByRole('button', { name: 'Approve', exact: true }).last(), 'Grant payment permission');
  await click(page.getByRole('button', { name: 'Consent demo', exact: true }).first(), 'Complete the mission');
  await page.getByRole('heading', { name: 'Mission complete' }).waitFor({ state: 'visible', timeout: 40_000 });
  await page.waitForTimeout(1200);
  await focus(page.getByText('Persistent receipt verified'), 'Every action leaves a receipt');
  await page.waitForTimeout(1600);
  await focus(page.getByText('BrowserOS bridge', { exact: true }), 'Ready for a broader browser runtime');
  await page.waitForTimeout(1300);

  await page.evaluate(() => {
    document.querySelectorAll('.demo-focus').forEach((node) => node.classList.remove('demo-focus'));
    const tag = document.querySelector('#demo-label'); if (tag) tag.style.opacity = '0';
  });
  await page.waitForTimeout(1200);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) await rename(await video.path(), join(outputDir, 'agent-pepper-real-demo.webm'));
}

console.log(join(outputDir, 'agent-pepper-real-demo.webm'));
