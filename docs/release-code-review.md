# Agent Pepper release code review

Reviewed the current working tree against `docs/hackathon-completion-plan.md`, focusing on consent approval/resume, BrowserDriver mission refresh, Atlas authorization and payment persistence, BrowserOS discovery, dashboard run controls, and CI/docs. Source files were not modified. This was a focused static review; no full build or test suite was run as part of this review.

## Findings

### P1 — Approval resolution can grant additional capabilities from page-controlled labels

- **Location:** `apps/server/src/store.ts:100–112`, especially lines 110–111; generated request originates in `apps/server/src/policy.ts:37`.
- **Evidence:** The policy embeds the inspected element label in a human-readable request, and `resolveApproval` applies every matching regular expression to the entire request. A label such as `Checkout — Approve payment` produces `Approve checkout for Checkout — Approve payment on example.com before Pepper proceeds.` Approving this checkout request grants both `checkout` and `payment`. The same mechanism can add credential or external-action capabilities. These labels are webpage content, not trusted capability metadata.
- **Impact:** Violates the plan invariant that an approval changes only the requested capability. A page can cause one approval to widen the mission boundary beyond the action classified by the policy.
- **Suggested fix:** Persist a structured capability enum with the approval and grant exactly that enum. Keep the label only as display context. For compatibility with old rows, parse only a strict, anchored canonical request prefix, using one mapping rather than all matching expressions. Add a regression case with capability names embedded in a label.

### P1 — Normal Codex runs do not preserve the approval pause

- **Location:** `apps/server/src/codex-agent.ts:88–90` and `apps/server/src/codex-agent.ts:73`.
- **Evidence:** A `PolicyError` from a dynamic tool creates a pending approval through the dispatcher, but `receive` only sends a failed tool result. It never changes the run from `running` to `waiting_approval` or stops dispatching further tools. When the model follows the instruction to stop and emits `turn/completed`, line 73 marks both run and mission completed because the run still says `running`, overriding the mission's `needs_approval` state. The consent demo has dedicated handling for this case; the normal Codex runner does not.
- **Impact:** Acceptance criterion 1 and the README's normal-agent pause/resume instructions are not met. A blocked mission is reported as completed, and the approval boundary depends on the model obeying prose instead of the runner enforcing a pause.
- **Suggested fix:** Catch `PolicyError` in the Codex tool dispatch boundary, persist `waiting_approval`, retain `needs_approval`, and prevent further actions/finalization in that run. Ensure turn completion cannot overwrite the paused state. Add a mocked RPC regression that emits a blocked tool call followed by turn completion.

### P1 — The clean CI runner lacks the Chromium required by the new integration test

- **Location:** `.github/workflows/ci.yml:16–18`; browser test at `apps/server/test/policy-and-store.test.mjs:123–146`.
- **Evidence:** CI runs `npm ci`, typecheck, and `npm test`, but never installs a Playwright browser. The newly added same-session consent test constructs the real `ToolDispatcher` and launches Chromium through `BrowserDriver.start`. The server test script builds and runs all `.mjs` tests; it has no browser installation step. Installing the `playwright` npm package does not supply the required browser executable.
- **Impact:** Automated verification fails on a clean Ubuntu runner before completing the consent integration test, contradicting acceptance criterion 4.
- **Suggested fix:** Add `npx playwright install --with-deps chromium` after dependency installation and before the tests. Keep the real browser regression in the required suite.

### P2 — Run controls allow overlapping executions of the same mission

- **Location:** `apps/web/src/App.tsx:36–38` and `apps/server/src/index.ts:54–60`.
- **Evidence:** The new run handlers clear `busy` when the POST returns HTTP 202, while the mission task continues asynchronously. The run buttons disable only on `busy`, not on the persisted running state. The server run route unconditionally creates another run and starts it, and the dispatcher shares one mutable BrowserDriver per mission. Clicking Run again after the first request returns can therefore launch two tasks against the same page; normal Codex runs also attempt to use the same fixed app-server port.
- **Impact:** Navigation and snapshot operations interleave, causing stale inspections, competing mission statuses, and potentially action receipts attributed to a run that no longer controls the page. This directly affects the newly exposed run/resume workflow.
- **Suggested fix:** Enforce one active execution per mission in the server, returning 409 for another start until that execution has ended or paused. Disable the controls while an active run is reported in the dashboard. The server guard is necessary even with UI disabling.

## Other reviewed areas

The BrowserDriver mission refresh addresses the stale-capability issue for sequential resumed runs. Atlas payment persistence is idempotent per mission and included in the exported decision packet. The BrowserOS health route and `status`/`cdpConnected` response match the preserved foundation implementation. No additional material finding was identified in these areas within this focused review.


## Resolution record

All four findings were corrected and re-verified after this review:

- Approvals now persist a typed `capability` and grant exactly one capability; a regression test proves page labels cannot widen a checkout approval into payment.
- The Codex runner records `waiting_approval` on `PolicyError`, blocks later tool calls in that run, and does not complete the mission when the model ends its turn.
- CI installs Playwright Chromium before its browser-backed test suite.
- The server returns HTTP 409 for a second active run, and the dashboard disables run controls while a mission is running.
