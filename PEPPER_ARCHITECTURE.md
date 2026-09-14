# Agent Pepper architecture

Agent Pepper is a self-contained Windows-local control plane with these modules:

| Module | State | Function |
| --- | --- | --- |
| Mission orchestrator | Runnable | Creates scoped tasks, capability boundaries, approvals, and one-active-run protection. |
| Browser session driver | Runnable | Opens isolated Chromium profiles and exposes semantic element handles. |
| Evidence engine | Runnable | Uses Anakin URL Scraper and keeps content hashes, receipts, and screenshots. |
| Workflow ledger | Runnable | Persists operations, evidence, approval history, checkpoints, exports, and sandbox actions. |
| Pepper Sandbox | Runnable | Demonstrates inspect, compare, idempotent cart staging, checkout approval, and local payment approval. |
| Optional BrowserOS bridge | Runnable status probe | Reports a configured loopback instance without importing, starting, or controlling BrowserOS. |

## Optional BrowserOS bridge

`GET /api/integrations/browseros` performs a short server-side health probe only when `BROWSEROS_ENDPOINT` is set to a loopback HTTP URL. The dashboard renders the result as an integration status panel. Agent Pepper has no BrowserOS source folder or runtime dependency.

## Consent-first controls

Checkout, payments, credential entry, account creation, order submission, and other externally consequential actions are available only after explicit user approval. Every approval records the exact typed capability separately from webpage-controlled display text. A missing domain or capability pauses the current run; a completed model turn cannot overwrite that waiting state. Web content is untrusted data and cannot modify Pepper's policy or tools.
