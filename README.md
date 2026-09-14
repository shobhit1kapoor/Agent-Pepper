# Agent Pepper

Agent Pepper is an original Windows-local browser agent for evidence-backed web work. It turns a goal into a mission with an approved-domain boundary and explicit capabilities, then records evidence, screenshots, approvals, and receipts locally.

## Runnable control plane

- **Browser missions:** scoped domains plus research, form-fill, cart, checkout, payment, credential-entry, account-creation, and external-action capabilities.
- **Live web evidence:** the optional Anakin URL Scraper captures approved public pages through the local server.
- **Visible browser sessions:** Playwright launches one isolated Chromium profile per mission.
- **Consent-first action ledger:** every browser operation, screenshot, content hash, approval, and decision packet persists locally. A missing domain or capability pauses the run.
- **Pepper Sandbox:** one-click cart analysis and a consent demonstration that separately pauses for checkout and payment approval, then writes a local-only receipt. It never contacts a retailer or payment provider.

Run it on independent local ports:

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:5174`. The server runs at `http://127.0.0.1:4410`.

## Evaluator quickstart

1. Click **Consent demo** in Mission Control.
2. Pepper researches the local Atlas storefront, stages the selected item, and pauses with a typed **checkout** approval.
3. Click **Approve**, then **Consent demo** again. It resumes and pauses with a typed **payment** approval.
4. Click **Approve**, then **Consent demo** once more. The decision packet records the local sandbox payment receipt and every browser action.

For a normal mission, create a mission with allowed domains and capabilities, then click **Run agent**. If it reaches a new domain or capability, it pauses until you resolve the visible approval request; click **Resume agent** afterward. One active run is permitted per mission.

Run the release checks with:

```powershell
npm run typecheck
npm test
npm run build
```

## Optional BrowserOS bridge

Agent Pepper includes no BrowserOS source or runtime. `GET /api/integrations/browseros` can report the health of an operator-started BrowserOS instance when `BROWSEROS_ENDPOINT` is explicitly set to a loopback HTTP URL. The bridge never starts BrowserOS, scans ports, imports its runtime, or calls MCP tools.

## Attribution

The Agent Pepper control plane is original project code, informed by a review of the user-supplied BrowserOS workspace and derived from the local Cartographer project in this workspace.
