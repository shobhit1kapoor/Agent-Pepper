# BrowserOS integration audit

## Recommendation

Expose one read-only Agent Pepper endpoint, for example `GET /api/integrations/browseros`, implemented in `apps/server/src/index.ts`. It should probe a configured loopback URL with a short timeout and return availability metadata for the dashboard. The dashboard can render that result in `apps/web/src/App.tsx` without ever loading BrowserOS code or calling its MCP tools.

This is the smallest safe integration point because it meets the completion plan's endpoint-discovery/status requirement while preserving the invariant that Pepper neither starts, installs, nor modifies BrowserOS.

## Observed BrowserOS contract

| Concern | Evidence | Assumption for Pepper |
| --- | --- | --- |
| Health endpoint | `the reviewed BrowserOS reference workspace/apps/server/src/api/routes/index.ts` mounts both `/system/health` and compatibility alias `/health`; `apps/server/src/api/routes/health.ts` returns `{ status: "ok" }` and, when available, `cdpConnected`. | Probe `GET {baseUrl}/system/health`; accept HTTP 200 only when JSON has `status: "ok"`. Treat `cdpConnected: false` as reachable but browser session unavailable. |
| Local URL | `the reviewed BrowserOS reference workspace/apps/app/lib/browseros/helpers.ts` builds local URLs as `http://127.0.0.1:${port}` and health URL as `/system/health`. | Default only to `http://127.0.0.1:9100`; allow an explicit Pepper environment override such as `BROWSEROS_ENDPOINT`. Do not scan ports or hosts. |
| Port variability | `the reviewed BrowserOS reference workspace/config.sample.json` uses server/proxy `9100`; `config.dev.json` uses `9105`; the same helper reads BrowserOS preferences at runtime. | A default is informational, never a discovery guarantee. Report the configured URL and that it is operator-provided. |
| MCP boundary | `the reviewed BrowserOS reference workspace/apps/server/src/api/routes/mcp.ts` provides `/mcp`, performs JSON-RPC dispatch, and has lease/authorization behavior. | Do not call `/mcp` for status, tool listing, or validation. That expands scope from availability discovery into BrowserOS runtime interaction. |
| Origin behavior | `the reviewed BrowserOS reference workspace/apps/server/src/api/middleware/require-trusted-origin.ts` and `apps/server/src/api/utils/cors.ts` reject unknown supplied origins but permit a request with no `Origin`. | Make the probe from Pepper's server, not the dashboard browser. Do not add an `Origin` header. |

## Suggested Pepper response shape

`{ configured: boolean, endpoint: string | null, reachable: boolean, status: "available" | "unavailable" | "not_configured", cdpConnected?: boolean, checkedAt: number, detail?: string }`

Use `BROWSEROS_ENDPOINT` only if it parses as an `http:` URL whose hostname is exactly `127.0.0.1` or `localhost`; otherwise report a configuration error and make no request. Set a short abort timeout (for example 750 ms). Never persist secrets, response bodies, or failure stacks.

The existing Pepper health route is at `apps/server/src/index.ts`; that is the natural co-located API surface. `apps/web/src/App.tsx` already polls the local Pepper API, so it can request this status alongside its normal refresh without introducing a browser-to-BrowserOS connection.

## Validation ideas

1. Unit-test the probe with mocked `fetch`: valid `status: ok`, `cdpConnected: false`, non-200, malformed JSON, timeout, and refused connection.
2. Verify a missing override reports `not_configured` (or a clearly labelled default-not-running state) and does not start any process.
3. Run a local BrowserOS instance only when an operator has started it, then confirm `GET /api/integrations/browseros` reports its exact configured loopback endpoint and `available`.
4. Browser-check that the dashboard renders available, reachable-with-CDP-disconnected, and unavailable states; verify no request is made to `/mcp`.
5. Regression-check `npm run typecheck`, `npm test`, and `npm run build` from the Agent Pepper root.

## Deliberate non-goals

No BrowserOS imports, package dependency, source copying, process launch, port scan, MCP initialization, tool discovery, or browser action belongs in this integration. Those all either pull in the AGPL runtime surface or convert a status panel into an active browser-control path.
