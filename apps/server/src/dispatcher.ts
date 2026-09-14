import type { BrowserDriver } from './browser.js';
import { BrowserDriver as Driver } from './browser.js';
import { CandidateSchema, EvidenceSchema, InspectSchema, InteractSchema, NavigateSchema, type Candidate, type Evidence, type Inspection, type Mission, type Receipt, type Run } from './contracts.js';
import { MissionPolicy, PolicyError } from './policy.js';
import { Store } from './store.js';

export class ToolDispatcher {
  private readonly drivers = new Map<string, BrowserDriver>();
  constructor(private readonly store: Store) {}

  private async driver(mission: Mission): Promise<BrowserDriver> { let driver = this.drivers.get(mission.id); if (!driver) { driver = new Driver(mission, this.store.dataDir); this.drivers.set(mission.id, driver); } else driver.updateMission(mission); await driver.start(); return driver; }
  private receipt(run: Run, action: string, url: string, status: Receipt['status'], details: Record<string, unknown>, beforeScreenshot?: string, afterScreenshot?: string): Receipt { return this.store.addReceipt({ missionId: run.missionId, runId: run.id, action, url, status, details, beforeScreenshot, afterScreenshot }); }
  private approval(mission: Mission, error: unknown): never {
    if (error instanceof PolicyError) { this.store.createApproval(mission.id, error.kind, error.request, error.capability); }
    throw error;
  }

  async navigate(mission: Mission, run: Run, raw: unknown): Promise<{ url: string; title: string; receipt: Receipt }> {
    const input = NavigateSchema.parse(raw); let url: URL;
    try { url = new MissionPolicy(mission).assertNavigation(input.url); } catch (error) { this.receipt(run, 'browser.navigate', input.url, 'blocked', { reason: error instanceof Error ? error.message : 'policy' }); return this.approval(mission, error); }
    const driver = await this.driver(mission); const before = await driver.screenshot('before-navigate');
    try { const result = await driver.navigate(url.toString()); const after = await driver.screenshot('after-navigate'); return { ...result, receipt: this.receipt(run, 'browser.navigate', result.url, 'succeeded', { requestedUrl: input.url }, before, after) }; }
    catch (error) { this.receipt(run, 'browser.navigate', input.url, 'failed', { reason: error instanceof Error ? error.message : 'navigation failed' }, before); throw error; }
  }

  async inspect(mission: Mission, run: Run, raw: unknown = {}): Promise<Inspection & { receipt: Receipt }> {
    const input = InspectSchema.parse(raw); const driver = await this.driver(mission);
    try { new MissionPolicy(mission).assertNavigation(await driver.url()); } catch (error) { return this.approval(mission, error); }
    try { const result = await driver.inspect(input.maxChars); return { ...result, receipt: this.receipt(run, 'browser.inspect', result.url, 'succeeded', { snapshotId: result.snapshotId, elements: result.elements.length, contentHash: result.contentHash }, undefined, result.screenshot) }; }
    catch (error) { this.receipt(run, 'browser.inspect', await driver.url(), 'failed', { reason: error instanceof Error ? error.message : 'inspection failed' }); throw error; }
  }

  async interact(mission: Mission, run: Run, raw: unknown): Promise<{ url: string; receipt: Receipt }> {
    const input = InteractSchema.parse(raw); const driver = await this.driver(mission); const before = await driver.screenshot('before-action');
    try { const result = await driver.interact(input); return { url: result.url, receipt: this.receipt(run, `browser.${input.kind}`, result.url, 'succeeded', { target: result.target, expected: input.expected ?? null }, before, result.screenshot) }; }
    catch (error) {
      const status = error instanceof PolicyError ? 'blocked' : 'failed';
      this.receipt(run, `browser.${input.kind}`, await driver.url(), status, { targetId: input.targetId, reason: error instanceof Error ? error.message : 'action failed' }, before);
      if (error instanceof PolicyError) this.approval(mission, error);
      throw error;
    }
  }

  captureEvidence(mission: Mission, raw: unknown, inspection: Inspection): Evidence {
    const input = EvidenceSchema.parse(raw);
    return this.store.addEvidence({ missionId: mission.id, candidateId: input.candidateId, sourceUrl: inspection.url, quote: input.quote, contentHash: inspection.contentHash, screenshot: inspection.screenshot });
  }
  upsertCandidate(mission: Mission, raw: unknown): Candidate { return this.store.addCandidate(mission.id, CandidateSchema.parse(raw)); }
  async stop(missionId: string): Promise<void> { const driver = this.drivers.get(missionId); await driver?.close(); this.drivers.delete(missionId); }
}
