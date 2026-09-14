import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadEnvFile } from 'node:process';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import websocket from '@fastify/websocket';
import { z } from 'zod';
import { AnakinScrapeSchema, MissionInputSchema } from './contracts.js';
import { Store } from './store.js';
import { ToolDispatcher } from './dispatcher.js';
import { registerAtlas } from './atlas.js';
import { runAtlasConsentDemo, runAtlasDemo } from './demo-runner.js';
import { CodexAppServerAgent } from './codex-agent.js';
import { AnakinClient } from './anakin.js';
import { MissionPolicy, PolicyError } from './policy.js';
import { probeBrowserOS } from './browseros.js';

try {
  loadEnvFile(join(import.meta.dirname, '..', '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const port = Number(process.env.PORT ?? 4410);
const dataDir = process.env.AGENT_PEPPER_DATA_DIR ?? join(import.meta.dirname, '..', '..', '..', '.agent-pepper');
mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, 'screenshots'), { recursive: true });
const store = new Store(dataDir);
const dispatcher = new ToolDispatcher(store);
const app = Fastify({ logger: true });
const sockets = new Set<{ send: (payload: string) => void; readyState: number }>();
const publish = (type: string, payload: unknown) => { const message = JSON.stringify({ type, payload, at: Date.now() }); for (const socket of sockets) if (socket.readyState === 1) socket.send(message); };

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) return reply.code(400).send({ error: 'Invalid request.', issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) });
  request.log.error(error);
  return reply.code(500).send({ error: 'Internal server error.' });
});

await app.register(cors, { origin: 'http://127.0.0.1:5174' });
await app.register(formbody);
await app.register(websocket);
await registerAtlas(app, store);

app.get('/artifacts/screenshots/:mission/:file', async (request, reply) => {
  const { mission, file } = request.params as { mission: string; file: string };
  if (!/^[a-f0-9-]{36}$/i.test(mission) || !/^\d+-[a-z-]+-[a-f0-9]{8}\.png$/i.test(file)) return reply.code(400).send({ error: 'Invalid artifact reference' });
  const path = join(dataDir, 'screenshots', mission, file);
  if (!existsSync(path)) return reply.code(404).send({ error: 'Artifact not found' });
  return reply.type('image/png').send(createReadStream(path));
});

const dashboard = (id: string) => ({ mission: store.getMission(id), activeRun: store.activeRun(id), candidates: store.candidates(id), evidence: store.evidence(id), receipts: store.receipts(id), approvals: store.approvals(id), cart: store.cart(id) });
app.get('/api/health', async () => ({ name: 'Agent Pepper', mode: 'local', codex: 'configured via existing CLI session' }));
app.get('/api/integrations/browseros', async () => probeBrowserOS(process.env.BROWSEROS_ENDPOINT));
app.get('/api/missions', async () => store.listMissions());
app.get('/api/missions/:id', async (request, reply) => { const state = dashboard((request.params as { id: string }).id); if (!state.mission) return reply.code(404).send({ error: 'Mission not found' }); return state; });
app.post('/api/missions', async (request, reply) => { const mission = store.createMission(MissionInputSchema.parse(request.body)); publish('mission.created', mission); return reply.code(201).send(mission); });
app.post('/api/missions/:id/runs', async (request, reply) => {
  const mission = store.getMission((request.params as { id: string }).id); if (!mission) return reply.code(404).send({ error: 'Mission not found' });
  const body = z.object({ mode: z.enum(['demo', 'consent_demo', 'codex']).default('demo') }).parse(request.body ?? {}); const activeRun = store.activeRun(mission.id); if (activeRun) return reply.code(409).send({ error: 'Mission already has an active run.', run: activeRun }); const run = store.createRun(mission.id, body.mode); publish('run.started', { missionId: mission.id, run });
  store.setMissionStatus(mission.id, 'running');
  const baseUrl = `http://127.0.0.1:${port}`;
  const task = body.mode === 'demo' ? runAtlasDemo(store, dispatcher, mission, run, baseUrl) : body.mode === 'consent_demo' ? runAtlasConsentDemo(store, dispatcher, mission, run, baseUrl) : new CodexAppServerAgent(store, dispatcher).run(mission, run);
  void task.then(() => publish('run.finished', dashboard(mission.id))).catch((error) => { publish('run.failed', { missionId: mission.id, message: error instanceof Error ? error.message : 'Run failed' }); });
  return reply.code(202).send(run);
});
app.post('/api/missions/:id/anakin-scrape', async (request, reply) => {
  const mission = store.getMission((request.params as { id: string }).id); if (!mission) return reply.code(404).send({ error: 'Mission not found' });
  const { url } = AnakinScrapeSchema.parse(request.body);
  try { new MissionPolicy(mission).assertNavigation(url); }
  catch (error) { if (error instanceof PolicyError) { const approval = store.createApproval(mission.id, error.kind, error.request, error.capability); store.setMissionStatus(mission.id, 'needs_approval'); publish('approval.requested', { missionId: mission.id, approval }); return reply.code(409).send({ error: error.message, approval }); } throw error; }
  const run = store.createRun(mission.id, 'anakin'); store.setMissionStatus(mission.id, 'running'); publish('anakin.started', { missionId: mission.id, run, url });
  void new AnakinClient().scrape(url).then((result) => {
    if (result.status !== 'completed') throw new Error(result.error || 'Anakin URL Scraper did not complete.');
    const content = (result.summary || result.markdown || '').replace(/\s+/g, ' ').trim();
    if (!content) throw new Error('Anakin returned no readable page content.');
    const evidence = store.addEvidence({ missionId: mission.id, sourceUrl: url, quote: content.slice(0, 1_500), contentHash: createHash('sha256').update(content).digest('hex') });
    store.addReceipt({ missionId: mission.id, runId: run.id, action: 'anakin.url_scraper', url, status: 'succeeded', details: { provider: 'anakin', jobId: result.id ?? result.jobId ?? null, durationMs: result.durationMs ?? null, cached: result.cached ?? null, evidenceId: evidence.id, untrustedWebContent: true } });
    store.setMissionStatus(mission.id, 'completed'); store.updateRun(run.id, 'completed', 'Anakin URL Scraper captured live, scoped research evidence.'); publish('anakin.completed', dashboard(mission.id));
  }).catch(async (error) => {
    const scraperReason = error instanceof Error ? error.message : 'Anakin scrape failed';
    store.addReceipt({ missionId: mission.id, runId: run.id, action: 'anakin.url_scraper', url, status: 'failed', details: { provider: 'anakin', reason: scraperReason } });
    try {
      const navigation = await dispatcher.navigate(mission, run, { url });
      const inspection = await dispatcher.inspect(mission, run, { maxChars: 4_000 });
      const content = inspection.content.replace(/\s+/g, ' ').trim();
      if (!content) throw new Error('Controlled browser returned no readable page content.');
      const evidence = dispatcher.captureEvidence(mission, { quote: content.slice(0, 1_500) }, inspection);
      store.addReceipt({ missionId: mission.id, runId: run.id, action: 'browser.fallback_capture', url: navigation.url, status: 'succeeded', details: { evidenceId: evidence.id, fallbackFor: 'anakin.url_scraper', scraperReason, untrustedWebContent: true, title: inspection.title } });
      store.setMissionStatus(mission.id, 'completed');
      store.updateRun(run.id, 'completed', 'Anakin was unavailable; the controlled browser captured scoped public research evidence.');
      publish('browser.fallback.completed', dashboard(mission.id));
    } catch (fallbackError) {
      const fallbackReason = fallbackError instanceof Error ? fallbackError.message : 'Controlled browser fallback failed';
      store.addReceipt({ missionId: mission.id, runId: run.id, action: 'browser.fallback_capture', url, status: 'failed', details: { fallbackFor: 'anakin.url_scraper', reason: fallbackReason } });
      store.setMissionStatus(mission.id, 'failed');
      store.updateRun(run.id, 'failed', `Anakin: ${scraperReason}; browser fallback: ${fallbackReason}`);
      publish('anakin.failed', { missionId: mission.id, message: fallbackReason });
    }
  });
  return reply.code(202).send(run);
});
app.post('/api/runs/:id/stop', async (request, reply) => { const run = store.getRun((request.params as { id: string }).id); if (!run) return reply.code(404).send({ error: 'Run not found' }); await dispatcher.stop(run.missionId); store.updateRun(run.id, 'stopped', 'Stopped by operator.'); store.setMissionStatus(run.missionId, 'stopped'); publish('run.stopped', { missionId: run.missionId, runId: run.id }); return { ok: true }; });
app.post('/api/approvals/:id/resolve', async (request, reply) => { const body = z.object({ status: z.enum(['approved', 'rejected']) }).parse(request.body); store.resolveApproval((request.params as { id: string }).id, body.status); return reply.send({ ok: true }); });
app.get('/api/missions/:id/export', async (request, reply) => { try { return reply.header('content-disposition', 'attachment; filename="agent-pepper-decision-packet.json"').send(store.exportMission((request.params as { id: string }).id)); } catch { return reply.code(404).send({ error: 'Mission not found' }); } });
app.get('/api/events', { websocket: true }, (socket) => { sockets.add(socket); socket.send(JSON.stringify({ type: 'connected', at: Date.now() })); socket.on('close', () => sockets.delete(socket)); });

await app.listen({ host: '127.0.0.1', port });


