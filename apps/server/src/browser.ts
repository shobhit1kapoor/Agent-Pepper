import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { Defuddle } from 'defuddle/node';
import type { ElementHandle, Inspection, Mission } from './contracts.js';
import { MissionPolicy } from './policy.js';

type Snapshot = { id: string; url: string; elements: Map<string, ElementHandle> };

export class BrowserDriver {
  private context?: BrowserContext;
  private page?: Page;
  private snapshot?: Snapshot;

  constructor(private mission: Mission, private readonly dataDir: string) {}

  updateMission(mission: Mission): void { this.mission = mission; }

  async start(): Promise<void> {
    if (this.page) return;
    const profile = join(this.dataDir, 'profiles', this.mission.id);
    mkdirSync(profile, { recursive: true });
    this.context = await chromium.launchPersistentContext(profile, {
      headless: process.env.CARTOGRAPHER_HEADLESS === 'true',
      viewport: { width: 1400, height: 900 },
      locale: 'en-US',
    });
    this.page = this.context.pages()[0] ?? await this.context.newPage();
  }

  private get active(): Page { if (!this.page) throw new Error('Browser has not started'); return this.page; }
  async url(): Promise<string> { return this.active.url(); }
  async navigate(url: string): Promise<{ url: string; title: string }> { await this.active.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 }); await this.active.waitForTimeout(200); return { url: this.active.url(), title: await this.active.title() }; }

  async screenshot(label: string): Promise<string> {
    const dir = join(this.dataDir, 'screenshots', this.mission.id);
    mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${label}-${randomUUID().slice(0, 8)}.png`;
    await this.active.screenshot({ path: join(dir, name), fullPage: false });
    return `/artifacts/screenshots/${this.mission.id}/${name}`;
  }

  async inspect(maxChars: number): Promise<Inspection> {
    const page = this.active;
    const rawElements = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role="button"],[role="link"]'))
        .filter((element) => {
          const style = window.getComputedStyle(element);
          return style.visibility !== 'hidden' && style.display !== 'none' && !element.hasAttribute('disabled');
        })
        .slice(0, 80);
      return candidates.map((element, index) => {
        const id = `ct_${index + 1}`;
        element.setAttribute('data-agent-pepper-target', id);
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute('role') || (tag === 'a' ? 'link' : tag === 'button' ? 'button' : tag);
        const label = (element.getAttribute('aria-label') || (element as HTMLInputElement).labels?.[0]?.textContent || (element as HTMLInputElement).value || element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        return { id, role, label, kind: tag === 'a' || role === 'link' ? 'link' : tag === 'select' ? 'select' : tag === 'input' || tag === 'textarea' ? 'input' : 'button' };
      });
    }) as ElementHandle[];
    const html = await page.content();
    let content: string;
    try { content = (await Defuddle(html, page.url(), { markdown: true })).content; } catch { content = await page.locator('body').innerText(); }
    content = content.replace(/\s+\n/g, '\n').trim().slice(0, maxChars);
    const result: Inspection = { snapshotId: randomUUID(), url: page.url(), title: await page.title(), content, contentHash: createHash('sha256').update(content).digest('hex'), elements: rawElements, screenshot: await this.screenshot('inspect') };
    this.snapshot = { id: result.snapshotId, url: result.url, elements: new Map(rawElements.map((item) => [item.id, item])) };
    return result;
  }

  async interact(input: { snapshotId: string; targetId: string; kind: 'click' | 'fill' | 'select'; value?: string; expected?: string }): Promise<{ url: string; screenshot: string; target: ElementHandle }> {
    if (!this.snapshot || this.snapshot.id !== input.snapshotId) throw new Error('Stale inspection. Inspect the current page before acting.');
    if (this.snapshot.url !== this.active.url()) throw new Error('The page changed after inspection. Inspect it again before acting.');
    const target = this.snapshot.elements.get(input.targetId);
    if (!target) throw new Error('Unknown semantic target. Inspect the page again.');
    new MissionPolicy(this.mission).assertInteraction({ kind: input.kind, label: target.label, role: target.role, url: this.active.url() });
    const locator = this.active.locator(`[data-agent-pepper-target="${input.targetId}"]`);
    if (await locator.count() !== 1) throw new Error('The chosen element no longer exists. Inspect the page again.');
    if (input.kind === 'click') await locator.click({ timeout: 10_000 });
    if (input.kind === 'fill') { if (input.value === undefined) throw new Error('Fill requires a value.'); await locator.fill(input.value, { timeout: 10_000 }); }
    if (input.kind === 'select') { if (input.value === undefined) throw new Error('Select requires a value.'); await locator.selectOption(input.value, { timeout: 10_000 }); }
    await this.active.waitForTimeout(250);
    if (input.expected && !(await this.active.locator('body').innerText()).includes(input.expected)) throw new Error(`Expected postcondition not found: ${input.expected}`);
    this.snapshot = undefined;
    return { url: this.active.url(), screenshot: await this.screenshot('action'), target };
  }

  async close(): Promise<void> { await this.context?.close(); this.context = undefined; this.page = undefined; }
}

