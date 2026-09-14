import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Approval, Candidate, Evidence, Mission, MissionInput, Permission, Receipt, Run } from './contracts.js';

type Row = Record<string, unknown>;
const json = (value: unknown) => JSON.stringify(value);
const parse = <T>(value: unknown): T => JSON.parse(String(value)) as T;

export class Store {
  private readonly db: DatabaseSync;

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'agent-pepper.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, title TEXT NOT NULL, brief TEXT NOT NULL, budget_cents INTEGER, quantity INTEGER NOT NULL, allowed_domains TEXT NOT NULL, permissions TEXT NOT NULL, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, completed_at INTEGER, summary TEXT);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, sequence INTEGER NOT NULL, action TEXT NOT NULL, url TEXT NOT NULL, status TEXT NOT NULL, details TEXT NOT NULL, before_screenshot TEXT, after_screenshot TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, candidate_id TEXT, source_url TEXT NOT NULL, quote TEXT NOT NULL, content_hash TEXT NOT NULL, screenshot TEXT, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, retailer TEXT NOT NULL, title TEXT NOT NULL, price_cents INTEGER NOT NULL, availability TEXT NOT NULL, url TEXT NOT NULL, score REAL NOT NULL, notes TEXT NOT NULL, evidence_ids TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, kind TEXT NOT NULL, request TEXT NOT NULL, capability TEXT, status TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS atlas_cart (mission_id TEXT NOT NULL, sku TEXT NOT NULL, title TEXT NOT NULL, quantity INTEGER NOT NULL, price_cents INTEGER NOT NULL, PRIMARY KEY(mission_id, sku));
      CREATE TABLE IF NOT EXISTS atlas_payments (mission_id TEXT PRIMARY KEY, reference TEXT NOT NULL, amount_cents INTEGER NOT NULL, created_at INTEGER NOT NULL);
    `);
    const approvalColumns = this.db.prepare('PRAGMA table_info(approvals)').all() as Row[];
    if (!approvalColumns.some((column) => String(column.name) === 'capability')) this.db.exec('ALTER TABLE approvals ADD COLUMN capability TEXT');
    this.db.exec(`
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY mission_id ORDER BY created_at, id) AS normalized_sequence
        FROM receipts
      )
      UPDATE receipts
      SET sequence = (SELECT normalized_sequence FROM ranked WHERE ranked.id = receipts.id);
    `);
  }

  createMission(input: MissionInput): Mission {
    const mission: Mission = { ...input, id: randomUUID(), status: 'draft', createdAt: Date.now() };
    this.db.prepare('INSERT INTO missions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(mission.id, mission.title, mission.brief, mission.budgetCents ?? null, mission.quantity, json(mission.allowedDomains), json(mission.permissions), mission.status, mission.createdAt);
    return mission;
  }

  private mission(row: Row): Mission {
    return { id: String(row.id), title: String(row.title), brief: String(row.brief), budgetCents: row.budget_cents === null ? undefined : Number(row.budget_cents), quantity: Number(row.quantity), allowedDomains: parse<string[]>(row.allowed_domains), permissions: parse<Mission['permissions']>(row.permissions), status: row.status as Mission['status'], createdAt: Number(row.created_at) };
  }
  getMission(id: string): Mission | undefined { const row = this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as Row | undefined; return row ? this.mission(row) : undefined; }
  listMissions(): Mission[] { return (this.db.prepare('SELECT * FROM missions ORDER BY created_at DESC').all() as Row[]).map((r) => this.mission(r)); }
  setMissionStatus(id: string, status: Mission['status']): void { this.db.prepare('UPDATE missions SET status = ? WHERE id = ?').run(status, id); }

  createRun(missionId: string, mode: Run['mode']): Run {
    const run: Run = { id: randomUUID(), missionId, mode, status: 'running', startedAt: Date.now() };
    this.db.prepare('INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?)').run(run.id, run.missionId, run.mode, run.status, run.startedAt, null, null);
    return run;
  }
  updateRun(id: string, status: Run['status'], summary?: string): void { this.db.prepare('UPDATE runs SET status = ?, completed_at = ?, summary = ? WHERE id = ?').run(status, Date.now(), summary ?? null, id); }
  private run(row: Row): Run { return { id: String(row.id), missionId: String(row.mission_id), mode: row.mode as Run['mode'], status: row.status as Run['status'], startedAt: Number(row.started_at), completedAt: row.completed_at === null ? undefined : Number(row.completed_at), summary: row.summary === null ? undefined : String(row.summary) }; }
  getRun(id: string): Run | undefined { const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined; return row ? this.run(row) : undefined; }
  activeRun(missionId: string): Run | undefined { const row = this.db.prepare("SELECT * FROM runs WHERE mission_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1").get(missionId) as Row | undefined; return row ? this.run(row) : undefined; }

  addReceipt(receipt: Omit<Receipt, 'id' | 'sequence' | 'createdAt'>): Receipt {
    const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM receipts WHERE mission_id = ?').get(receipt.missionId) as Row;
    const value: Receipt = { ...receipt, id: randomUUID(), sequence: Number(next.next), createdAt: Date.now() };
    this.db.prepare('INSERT INTO receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.missionId, value.runId, value.sequence, value.action, value.url, value.status, json(value.details), value.beforeScreenshot ?? null, value.afterScreenshot ?? null, value.createdAt);
    return value;
  }
  receipts(missionId: string): Receipt[] { return (this.db.prepare('SELECT * FROM receipts WHERE mission_id = ? ORDER BY sequence DESC').all(missionId) as Row[]).map((r) => ({ id: String(r.id), missionId: String(r.mission_id), runId: String(r.run_id), sequence: Number(r.sequence), action: String(r.action), url: String(r.url), status: r.status as Receipt['status'], details: parse(r.details), beforeScreenshot: r.before_screenshot === null ? undefined : String(r.before_screenshot), afterScreenshot: r.after_screenshot === null ? undefined : String(r.after_screenshot), createdAt: Number(r.created_at) })); }

  addEvidence(item: Omit<Evidence, 'id' | 'createdAt'>): Evidence {
    const existing = this.db.prepare('SELECT * FROM evidence WHERE mission_id = ? AND source_url = ? AND quote = ? AND content_hash = ?').get(item.missionId, item.sourceUrl, item.quote, item.contentHash) as Row | undefined;
    if (existing) return { id: String(existing.id), missionId: String(existing.mission_id), candidateId: existing.candidate_id === null ? undefined : String(existing.candidate_id), sourceUrl: String(existing.source_url), quote: String(existing.quote), contentHash: String(existing.content_hash), screenshot: existing.screenshot === null ? undefined : String(existing.screenshot), createdAt: Number(existing.created_at) };
    const value: Evidence = { ...item, id: randomUUID(), createdAt: Date.now() }; this.db.prepare('INSERT INTO evidence VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.missionId, value.candidateId ?? null, value.sourceUrl, value.quote, value.contentHash, value.screenshot ?? null, value.createdAt); return value;
  }
  evidence(missionId: string): Evidence[] { return (this.db.prepare('SELECT * FROM evidence WHERE mission_id = ? ORDER BY created_at DESC').all(missionId) as Row[]).map((r) => ({ id: String(r.id), missionId: String(r.mission_id), candidateId: r.candidate_id === null ? undefined : String(r.candidate_id), sourceUrl: String(r.source_url), quote: String(r.quote), contentHash: String(r.content_hash), screenshot: r.screenshot === null ? undefined : String(r.screenshot), createdAt: Number(r.created_at) })); }

  addCandidate(missionId: string, item: Omit<Candidate, 'id' | 'missionId' | 'createdAt'>): Candidate {
    const existing = this.db.prepare('SELECT * FROM candidates WHERE mission_id = ? AND url = ?').get(missionId, item.url) as Row | undefined;
    if (existing) {
      this.db.prepare('UPDATE candidates SET retailer = ?, title = ?, price_cents = ?, availability = ?, score = ?, notes = ?, evidence_ids = ? WHERE id = ?').run(item.retailer, item.title, item.priceCents, item.availability, item.score, item.notes, json(item.evidenceIds), String(existing.id));
      return { id: String(existing.id), missionId, ...item, createdAt: Number(existing.created_at) };
    }
    const value: Candidate = { ...item, missionId, id: randomUUID(), createdAt: Date.now() }; this.db.prepare('INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(value.id, value.missionId, value.retailer, value.title, value.priceCents, value.availability, value.url, value.score, value.notes, json(value.evidenceIds), value.createdAt); return value;
  }
  candidates(missionId: string): Candidate[] { return (this.db.prepare('SELECT * FROM candidates WHERE mission_id = ? ORDER BY score DESC, price_cents ASC').all(missionId) as Row[]).map((r) => ({ id: String(r.id), missionId: String(r.mission_id), retailer: String(r.retailer), title: String(r.title), priceCents: Number(r.price_cents), availability: r.availability as Candidate['availability'], url: String(r.url), score: Number(r.score), notes: String(r.notes), evidenceIds: parse<string[]>(r.evidence_ids), createdAt: Number(r.created_at) })); }

  createApproval(missionId: string, kind: Approval['kind'], request: string, capability?: Permission): Approval {
    const value: Approval = { id: randomUUID(), missionId, kind, request, capability, status: 'pending', createdAt: Date.now() };
    this.db.prepare('INSERT INTO approvals(id, mission_id, kind, request, capability, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(value.id, value.missionId, value.kind, value.request, value.capability ?? null, value.status, value.createdAt);
    this.setMissionStatus(missionId, 'needs_approval');
    return value;
  }
  private legacyCapability(request: string): Permission | undefined {
    const matches: Array<[RegExp, Permission]> = [
      [/^Approve form filling for this mission before changing a field\.$/i, 'form_fill'],
      [/^Approve cart additions for this mission before adding an item\.$/i, 'cart_add'],
      [/^This mission does not permit research\/navigation\.$/i, 'research'],
      [/^Approve checkout for /i, 'checkout'],
      [/^Approve payment for /i, 'payment'],
      [/^Approve credential entry for /i, 'credential_entry'],
      [/^Approve account creation for /i, 'account_creation'],
      [/^Approve external action for /i, 'external_action'],
    ];
    return matches.find(([expression]) => expression.test(request))?.[1];
  }
  resolveApproval(id: string, status: 'approved' | 'rejected'): void {
    const approval = this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Row | undefined;
    if (!approval) return;
    this.db.prepare('UPDATE approvals SET status = ? WHERE id = ?').run(status, id);
    if (status !== 'approved') return;
    const mission = this.getMission(String(approval.mission_id));
    if (!mission) return;
    let allowedDomains = mission.allowedDomains;
    let permissions = mission.permissions;
    if (approval.kind === 'domain') {
      const matched = /^Approve ([^\s]+) before browsing it\.$/.exec(String(approval.request));
      if (matched && !allowedDomains.includes(matched[1])) allowedDomains = [...allowedDomains, matched[1]];
    }
    if (approval.kind === 'action') {
      const capability = approval.capability === null || approval.capability === undefined ? this.legacyCapability(String(approval.request)) : String(approval.capability) as Permission;
      if (capability && !permissions.includes(capability)) permissions = [...permissions, capability];
    }
    this.db.prepare('UPDATE missions SET allowed_domains = ?, permissions = ? WHERE id = ?').run(json(allowedDomains), json(permissions), mission.id);
    const pending = this.db.prepare("SELECT 1 FROM approvals WHERE mission_id = ? AND status = 'pending' LIMIT 1").get(mission.id);
    if (!pending) this.setMissionStatus(mission.id, 'draft');
  }
  approvals(missionId: string): Approval[] { return (this.db.prepare('SELECT * FROM approvals WHERE mission_id = ? ORDER BY created_at DESC').all(missionId) as Row[]).map((row) => ({ id: String(row.id), missionId: String(row.mission_id), kind: row.kind as Approval['kind'], request: String(row.request), capability: row.capability === null || row.capability === undefined ? undefined : row.capability as Permission, status: row.status as Approval['status'], createdAt: Number(row.created_at) })); }

  cart(missionId: string): Array<{ sku: string; title: string; quantity: number; priceCents: number }> { return (this.db.prepare('SELECT sku, title, quantity, price_cents FROM atlas_cart WHERE mission_id = ?').all(missionId) as Row[]).map((r) => ({ sku: String(r.sku), title: String(r.title), quantity: Number(r.quantity), priceCents: Number(r.price_cents) })); }
  addToCart(missionId: string, item: { sku: string; title: string; quantity: number; priceCents: number }): void { this.db.prepare('INSERT INTO atlas_cart(mission_id, sku, title, quantity, price_cents) VALUES (?, ?, ?, ?, ?) ON CONFLICT(mission_id, sku) DO UPDATE SET quantity = excluded.quantity, title = excluded.title, price_cents = excluded.price_cents').run(missionId, item.sku, item.title, item.quantity, item.priceCents); }
  sandboxPayment(missionId: string): { reference: string; amountCents: number } | undefined { const row = this.db.prepare('SELECT reference, amount_cents FROM atlas_payments WHERE mission_id = ?').get(missionId) as Row | undefined; return row ? { reference: String(row.reference), amountCents: Number(row.amount_cents) } : undefined; }
  confirmSandboxPayment(missionId: string, payment: { reference: string; amountCents: number }): void { this.db.prepare('INSERT INTO atlas_payments(mission_id, reference, amount_cents, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(mission_id) DO NOTHING').run(missionId, payment.reference, payment.amountCents, Date.now()); }

  exportMission(id: string): Record<string, unknown> { const mission = this.getMission(id); if (!mission) throw new Error('Mission not found'); const candidates = this.candidates(id); return { exportedAt: new Date().toISOString(), mission, recommendation: candidates[0] ?? null, candidates, evidence: this.evidence(id), receipts: this.receipts(id), approvals: this.approvals(id), cart: this.cart(id), sandboxPayment: this.sandboxPayment(id) ?? null }; }
  close(): void { this.db.close(); }
}


