# Cartographer

Cartographer is a local evidence-backed shopping agent. It researches approved pages, records the proof behind a recommendation, and can assemble an item in a cart without ever entering checkout.

It is built for [Anakin Forge](https://anakin.io/hackathon/anakin-forge): the live-research route uses Anakin URL Scraper, so a mission can read a public approved URL through Anakin's production web infrastructure before its agent reasons over the evidence.

## Start

```powershell
npm install
npx playwright install chromium
npm run dev
```

Open `http://127.0.0.1:5173`. Select **Run Atlas demo** for an end-to-end local workflow that opens a dedicated browser window, compares supplies, and adds the chosen item to the Atlas Supply cart.

`npm run build`, `npm run typecheck`, and `npm test` validate the project. Cartographer stores all local state in `.cartographer/`; remove that folder to reset the demo.

## Safety boundary

Each mission has a domain allowlist and only three capabilities: `research`, `form_fill`, and `cart_add`. Checkout, payment, credentials, account creation, and order submission are denied by the local policy executor, independent of model output. Webpage text is evidence, never instruction.

## Live Codex runs

The service includes an experimental Codex App Server adapter for a ChatGPT-authenticated `codex` CLI. It permits only the same validated, mission-scoped dynamic tools used by the demo, and refuses to mark a run complete unless the model actually invokes one. The bundled Atlas and Anakin workflows remain fully runnable without a model run. Page text is cleaned through the maintained `defuddle` package before being passed to an agent.

## Anakin integration

Cartographer's **Anakin live research** field calls `POST https://api.anakin.io/v1/url-scraper/scrape` from the local service, never from the browser. Anakin's Zero Touch route works without a key for public, read-only research. Set `ANAKIN_API_KEY` before `npm run dev` to use the authenticated Anakin tier; the key remains server-side. Every result is stored as untrusted evidence with its own receipt and is still constrained by the mission domain allowlist.
