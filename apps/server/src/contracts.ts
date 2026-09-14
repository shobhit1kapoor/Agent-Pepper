import { z } from 'zod';

export const PermissionSchema = z.enum(['research', 'form_fill', 'cart_add', 'checkout', 'payment', 'credential_entry', 'account_creation', 'external_action']);
export type Permission = z.infer<typeof PermissionSchema>;

export const MissionInputSchema = z.object({
  title: z.string().trim().min(3).max(120),
  brief: z.string().trim().min(12).max(3_000),
  budgetCents: z.number().int().positive().optional(),
  quantity: z.number().int().min(1).max(50).default(1),
  allowedDomains: z.array(z.string().trim().min(1)).min(1).max(20),
  permissions: z.array(PermissionSchema).min(1).max(8),
});
export type MissionInput = z.infer<typeof MissionInputSchema>;

export type Mission = MissionInput & {
  id: string;
  status: 'draft' | 'running' | 'needs_approval' | 'completed' | 'stopped' | 'failed';
  createdAt: number;
};

export type Run = {
  id: string;
  missionId: string;
  mode: 'demo' | 'consent_demo' | 'codex' | 'anakin';
  status: 'running' | 'waiting_approval' | 'completed' | 'stopped' | 'failed';
  startedAt: number;
  completedAt?: number;
  summary?: string;
};

export type Receipt = {
  id: string;
  missionId: string;
  runId: string;
  sequence: number;
  action: string;
  url: string;
  status: 'started' | 'succeeded' | 'blocked' | 'failed';
  details: Record<string, unknown>;
  beforeScreenshot?: string;
  afterScreenshot?: string;
  createdAt: number;
};

export type Evidence = {
  id: string;
  missionId: string;
  candidateId?: string;
  sourceUrl: string;
  quote: string;
  contentHash: string;
  screenshot?: string;
  createdAt: number;
};

export type Candidate = {
  id: string;
  missionId: string;
  retailer: string;
  title: string;
  priceCents: number;
  availability: 'in_stock' | 'low_stock' | 'out_of_stock' | 'unknown';
  url: string;
  score: number;
  notes: string;
  evidenceIds: string[];
  createdAt: number;
};

export type Approval = {
  id: string;
  missionId: string;
  kind: 'domain' | 'action';
  request: string;
  capability?: Permission;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: number;
};

export const NavigateSchema = z.object({ url: z.string().url() });
export const InspectSchema = z.object({ maxChars: z.number().int().min(500).max(20_000).default(7_000) });
export const InteractSchema = z.object({
  snapshotId: z.string().min(1),
  targetId: z.string().min(1),
  kind: z.enum(['click', 'fill', 'select']),
  value: z.string().max(500).optional(),
  expected: z.string().max(200).optional(),
});
export const EvidenceSchema = z.object({
  candidateId: z.string().optional(),
  quote: z.string().trim().min(3).max(2_000),
});
export const CandidateSchema = z.object({
  retailer: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  priceCents: z.number().int().nonnegative(),
  availability: z.enum(['in_stock', 'low_stock', 'out_of_stock', 'unknown']),
  url: z.string().url(),
  score: z.number().min(0).max(100),
  notes: z.string().max(1_000).default(''),
  evidenceIds: z.array(z.string()).max(10).default([]),
});
export const AnakinScrapeSchema = z.object({ url: z.string().url() });

export type ElementHandle = { id: string; role: string; label: string; kind: 'button' | 'link' | 'input' | 'select' };
export type Inspection = { snapshotId: string; url: string; title: string; content: string; contentHash: string; elements: ElementHandle[]; screenshot: string };
