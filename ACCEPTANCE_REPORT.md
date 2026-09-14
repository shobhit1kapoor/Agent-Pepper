# Agent Pepper acceptance report

Validated locally on 2026-09-13 with the API at `127.0.0.1:4410` and dashboard at `127.0.0.1:5174`.

## Automated checks

- `npm run typecheck` passed.
- `npm test` passed: 12 tests, including full consent-run resumption in one browser session, payment idempotency, Atlas authorization, and BrowserOS loopback discovery.
- `npm run build` passed for the Fastify service and Vite dashboard.
- `npm audit --omit=dev` reported 0 vulnerabilities.

## Dashboard sandbox workflow

Mission `d33c8f8f-947f-4ab9-b826-b3d4054b99c3` was started from the visible dashboard while the active mission only approved `example.com`. Agent Pepper created and selected a correctly scoped Pepper Sandbox mission, updated the URL, and completed the run.

- 3 evidence-backed candidates
- 3 durable evidence records
- 9 ordered browser receipts
- 1 staged cart line with quantity 1
- Export contains a recommendation and all 9 receipts

The restarted mission `c3ba3f07-70d7-491b-b9bf-22a761f38c7a` retained its single cart line. Its third run produced receipt sequences 19–27, with 27 unique sequence values across all runs.

## Policy checks

- An unapproved `iana.org` research request returned HTTP 409 before provider work.
- A malformed URL returned HTTP 400.
- Unit tests confirm checkout, payment, credential entry, account creation, and external actions pause for the required capability and become available only after explicit approval.

## Consent workflow verification

Mission `9ce7b413-a2ee-4133-8829-292f4323edfd` completed the real local consent workflow through the Fastify server and isolated Playwright browser.

- Checkout paused with an exact checkout approval request.
- After approval, the same browser session resumed and paused with an exact payment approval request.
- After the second approval, the mission completed with one staged cart line, 24 browser receipts, and a local-only `$119.00` sandbox payment receipt.
- No retailer, credential, payment provider, or real transaction was contacted.

## Live public-product checks

The IKEA mission `90838bf0-a509-41e7-a7d8-5cf406d083c9` completed a live Anakin scrape of an approved public product page.

The Amazon mission `b572a2a1-b34b-459c-be80-ba6dd0347bc9` completed a live Anakin scrape of the Amazon Echo Dot public listing at `https://www.amazon.com/dp/B09B8V1LZ3`. It produced one evidence record and one durable research receipt. No Amazon sign-in, cart, checkout, payment, or purchase action occurred.

An earlier Amazon request briefly returned a provider scrape failure. The controlled Playwright browser then successfully navigated to the same public product page, read its content, and stored evidence without interaction. Agent Pepper now automatically uses that controlled read-only fallback when an Anakin scrape fails.

The fallback was exercised deterministically in an isolated local service by pointing only that test service at an unavailable scraper endpoint. The same real Amazon page completed with one evidence record and four receipts: failed scraper request, browser navigation, browser inspection, and succeeded fallback capture.

## Fixes made during acceptance

- Receipt sequences are mission-global; existing receipts are normalized on service startup.
- The mobile breakpoint no longer hides the New mission control.
- Successful reloads clear transient service errors.
- Selecting or creating a mission updates the dashboard URL.
- Pepper Sandbox creation uses the correct local authorization boundary.
- Live evidence wording now accurately covers either Anakin or controlled-browser capture.
- Anakin failures automatically fall back to controlled, scoped, read-only browser research.
