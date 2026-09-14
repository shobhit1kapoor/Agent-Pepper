# Agent Pepper hackathon completion plan

## Acceptance criteria

1. Operators can start a normal Codex-backed mission and explicitly resume it after an approval.
2. The local Pepper Sandbox demonstrates a full consent sequence: a sensitive/elevated action creates a blocking approval, then succeeds only after an explicit approval and a fresh run.
3. The dashboard explains runtime capability availability, including the preserved BrowserOS foundation and its optional local endpoint.
4. Project setup, automated checks, and a live demo path are reproducible from a clean checkout.

## Tasks

1. Add mission run and resume controls to the dashboard and preserve run mode in the durable store.
2. Add an Atlas elevated-action route plus integration tests for request, approval, resume, and receipt behavior.
3. Add BrowserOS endpoint discovery and a dashboard integration-status panel without importing or redistributing BrowserOS runtime code.
4. Add CI and an evaluator-facing quickstart, then run full typecheck, test, build, local API, and browser checks.

## Invariants

- Browser interaction remains limited to inspected semantic targets.
- A blocked action persists a receipt and a pending approval before a browser side effect occurs.
- Approval changes only the requested capability or domain; a fresh run reads the new mission state.
- BrowserOS remains an optional local integration. Agent Pepper never starts, installs, or modifies it automatically.
