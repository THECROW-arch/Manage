# MANAGED — Codebase Overview & Findings

> Note: I attempted to save this as `project_info__1.md` in the project root, but the file write was declined, so the report lives here in chat only. Say the word and I'll retry the save.

## Summary

MANAGED is a single-page personal-finance / budget-allocation app. A user sets a monthly net salary, splits it across percentage-based categories (Needs/Wants/Savings-style), logs expenses, tracks "wealth assets" and "wealth objectives", runs hypothetical budgets in a sandbox, talks to a natural-language assistant called **Sterling**, and exports formal Excel audits. It's monetised: **MANAGED Pro** gates Excel exports, >3 categories, >1 sandbox sheet, >1 wealth objective, and unlimited AI commands. Billing goes through Creem (primary) or Lemon Squeezy (legacy) via a Supabase Edge Function, plus owner/dev dashboards for tickets, roles and tiers.

Stack: React 19 + Vite 8 (rolldown) + Tailwind, Supabase (auth/Postgres/Edge Functions), i18next (EN/FR/ES/AR), Recharts, ExcelJS, Transformers.js (Whisper) for on-device voice.

**The critical structural fact: there is no backend source of truth in this repo.** No schema, no RLS policies, no SQL for ~20 RPCs. Only the client and two Edge Functions are here. Everything security-relevant about data access is invisible to review — that's the root cause of most findings below.

## Architecture

- **Pattern:** one central "god component" (`App.jsx`, ~2,000 lines) owns *all* domain state and passes ~120 individual props to tabs. No router (tabs = a `useState` string in localStorage), no store, no query layer, no data-access abstraction.
- **Backend:** Postgres accessed directly from the browser with the anon key; privileged work only in `supabase/functions/`.
- **Persistence:** dual. Everything meaningful is written to Postgres *and* mirrored to `localStorage` with hand-written merge rules.
- **Concurrency:** `useEffect` + `useCallback` + debounce timers, plus three module-level globals on `window` (`__activeUserId`, `__fetchingUserId`, `__loadedUserId`) used for stale-response detection.
- **Entry:** `main.jsx` → `ErrorBoundary` → `App` → `Auth` | loading | `Sidebar` + `NotificationBell` + lazy tab + `AIAssistantDrawer`.

## Directory Structure

```
c:/Manage/
├── index.html            — SPA shell + inline favicon script (CSP hazard)
├── vite.config.js        — chunk splitting: vendor-react / supabase / charts / i18n
├── .env                  — present locally, gitignored (VITE_SUPABASE_URL / _ANON_KEY …)
├── public/_headers       — CSP, HSTS, frame headers
├── src/
│   ├── App.jsx           — ★ orchestrator: auth, all state, all mutations, tab routing
│   ├── Auth.jsx          — sign-in/up, password recovery, ToS gate
│   ├── supabaseClient.js — createClient(env), no validation
│   ├── i18n.js           — single-file dictionary, en/fr/es/ar
│   ├── components/       — CashFlow, OccasionsSandbox, Portfolio, WealthObjectives,
│   │                       Settings, AIAssistantDrawer, NotificationBell, Sidebar,
│   │                       Support, DevDashboard, OwnerDashboard, TaxCenter, History, Legal, ErrorBoundary
│   └── utils/
│       ├── aiAgentEngine.js       — ★ rule-based NLU: ~23 regex intent handlers (no LLM)
│       ├── aiQuotaManager.js      — localStorage free-tier quota
│       ├── billingService.js      — checkout / cancel / refund with stale-account guards
│       ├── emailReminderService.js— template + dedupe + queue logging
│       ├── excelGenerator.js      — ExcelJS formal audit + visual dashboard
│       ├── voiceTranscriber.js    — Whisper pipeline + resampler
│       ├── constants.js           — colours, tax brackets, dates, sanitizeUsername
│       └── constants.test.js      — node:assert tests nothing runs
└── supabase/functions/
    ├── billing-manager/index.ts        — webhook receiver + checkout/cancel/refund
    └── send-recurring-reminder/index.ts— HTML sanitizer + Resend dispatch
```

**Missing:** `supabase/migrations/`, `supabase/config.toml`, `.env.example`, CI, any test runner.

## Key Abstractions

**`App`** — owns session, `categories`, `expenses`, `bundles`, `sandboxSheets`, `assetAdjustments`, `closedMonths`, every form draft, all billing state, the read-only rule, autosave, reminders, and every mutation. `fetchUserData` hydrates sequentially and seeds `Needs 50 / Wants 30 / Savings 20`. Central invariant: `isReadOnly = isPastMonth || (selectedMonth === todayMonth && isCurrentMonthClosed)`.

**`processAIAgentTurn(rawInput, ctx)`** — ordered regex cascade after `normalizeTypos()` maps FR/ES/AR onto canonical English intents. Returns `{ reply, actionBadge?, suggestions? }` and mutates through callbacks in `ctx`.

**`getCategoryAvailablePool(catId)`** — single source of truth for spendable/pullable funds: allocation − spent − open-bundle reservations (assets use lifetime adjustments + a preview of unspent current-month allocation). Used by expenses, bundles, objectives, and the AI's direct-write paths.

**`billing-manager`** — one endpoint, four behaviours. HMAC timing-safe compare, event-ID dedupe table, optimistic-concurrency guard on `subscription_updated_at`, refund idempotency markers, and "historical event" rejection so an old refund can't cancel a newer subscription.

**`send-recurring-reminder`** — the only path to Resend; verifies the JWT, forces `to` = authenticated email, sanitizes HTML with a hand-written parser-based allowlist.

## Data Flow

**Sign-in → hydrated workspace:** `getSession` → `fetchUserData` sets `window.__activeUserId`, reads `profiles` (inserting a row if absent), then categories → expenses → bundles → sandbox → adjustments → closed months; each step re-checks `isStale()` before committing.

**Logging an expense:** validated against `getCategoryAvailablePool` → optimistic row with a `crypto.randomUUID()` temp id → `insert().select()` replaces it (temp row removed on error) → recurrence metadata goes to a *separate* store (`updateExpenseMeta` → `metaOverridesByUser` → localStorage → serialized queue → `profiles.expense_meta` JSON).

**Month close:** aggregate batched rows → forward recurring rows → sweep unspent assets into `asset_adjustments` → streak update → insert `closed_months` snapshot → advance month.

**Upgrade/refund:** `startProCheckoutSession` → provider → `?checkout=success` → App strips the param and polls `profiles` 6×/2.5 s → banner with manual retry if it never flips.

---

# Problems Found

### 1. Security — the entire trust boundary is unversioned (highest priority)
No `supabase/migrations/`. The client calls `check_username_available`, `mark_pro_feature_used`, `delete_user_account`, `get_saas_metrics_for_owner`, `get_all_profiles_for_owner`, `owner_update_user_profile` — none defined in the repo. Tables (`profiles`, `categories`, `expenses`, `bundles`, `sandbox_sheets`, `asset_adjustments`, `closed_months`, `support_tickets`, `email_reminder_queue`, `billing_webhook_events`) have no DDL or RLS either. Nobody reviewing this repo can verify that a user can't read/write another user's rows, and environments can drift freely.

### 2. Security — privilege escalation around `profiles.role`
`hasProAccess` and the Dev/Owner dashboards all derive from `profiles.role` / `subscription_tier`, and `App.jsx` performs a client-side `supabase.from('profiles').upsert({...})`. If `profiles` carries a table-level `UPDATE` grant for `authenticated` (the default when RLS is loose), any signed-in user can run `update profiles set role='owner'` from the console and get the Owner Command Center, the full ticket queue, and free Pro. Needs column-level grants or a `BEFORE UPDATE` trigger blocking client writes to `role`, `subscription_*`, `pro_features_used`, `has_claimed_refund`. Same class: `owner_update_user_profile(target_user_id, new_role, new_tier)` is callable from the browser.

### 3. Business — all Pro gating is client-side and trivially bypassable
`aiQuotaManager.js` stores the 5-per-48h counter as a localStorage timestamp array — clearing storage or a private window resets it. Every gate (`handleExportData`, `handleAddCategory`, `handleCreateSandboxSheet`, `handleCreateWealthObjective`, `onDirectCreateSandbox`, `onDirectCreateCategory`) checks `hasProAccess` in the browser only. Only payments themselves are server-enforced.

### 4. Security — `ALLOW_SANDBOX_SIMULATION=true` hands out free Pro
In `billing-manager/index.ts`, when no provider is configured and that flag is `"true"`, `create_checkout` writes `subscription_tier: "pro"` for the caller. No allowlist, no production guard, documented nowhere. A leftover secret = unlimited free Pro.

### 5. Security — the CSP blocks the app's own inline script
`public/_headers` sets `script-src 'self' 'wasm-unsafe-eval' blob:` — no `'unsafe-inline'`, hash, or nonce — while `index.html` ships an inline `<script>` for the favicon. On any host that applies `_headers`, that script is silently blocked. It also calls `ctx.roundRect()` unguarded (throws on older Safari).

### 6. Data integrity — metadata written for a row that doesn't exist yet
`handleAddExpense` calls `updateExpenseMeta(tempId, { recurrenceType })` with the client temp UUID **before** the insert resolves, then writes it again under the real id. The temp-id entry is never deleted, so `profiles.expense_meta` (and `managed_unsynced_expense_meta_<uid>`) accumulates keys for non-existent expenses on every recurring expense creation.

### 7. Data integrity — month close is a 5-step non-transactional sequence
Delete batched → insert aggregated → insert forwarded recurring → insert adjustments → streak update → insert `closed_months`. If anything after the first delete fails, the `catch` restores only React state; the database keeps the deletions/insertions. The user sees an error, the ledger is half-migrated, the month isn't closed. This needs one Postgres function.

### 8. Logic bug — `daily` recurrence silently becomes monthly
```js
const targetDate = sourceFreq === 'yearly' ? nextYearStamp : nextMonthStamp;
```
`daily` falls into the monthly branch, so every daily bill becomes a single next-month row. Every recurring row is also copied regardless of `skippedPeriods` — skipped bills are resurrected.

### 9. Logic bug — insert/select ordering assumption
```js
newRecurring.forEach((insertedRow, idx) => { const sourceExp = recurringExpenses[idx]; … })
```
Assumes PostgREST returns inserted rows in input order. It does today; if it changes, recurrence types attach to the wrong expenses.

### 10. Missing read-only guard + no rollback — asset adjustments
`handleAddAdjustment` is the **only** mutation in `App.jsx` without `if (isReadOnly) return`, so portfolio adjustments can be added to a closed or past month, breaking the frozen-ledger invariant the Excel audit's `category_snapshot` logic depends on. It also leaves the optimistic row in state when the insert fails. `handleAddSubBucket` and `handleAddSandboxExpense` skip `isReadOnly` too.

### 11. Misleading arithmetic
`const totalRemaining = Math.max(0, parsedSalary - totalAllocated);` — overspend is clamped to `0`, so the headline remaining figure (and the AI's "how much can I spend per day") can never show a deficit. Overspenders see `0` instead of `−420`.

### 12. Category deletion doesn't clean up its data
`handleDeleteCategory` deletes only the `categories` row, drops expenses from *local* state, and dumps the whole percentage onto `remainingCategories[0]` clamped by `Math.min(100, …)`. Without `ON DELETE CASCADE` the expenses orphan; the redistribution can leave the total under 100 %, which the UI then reports as "unallocated income".

### 13. Abuse vector — unrestricted outbound email
`send-recurring-reminder` validates `to === authenticated email` and sanitizes HTML, but accepts any `subject`/`html`/`text` and sends immediately with the Resend key. Any signed-in user can loop it, burning quota and sender reputation. No rate limit, no server-side dedupe (dedupe lives entirely in the client).

### 14. Webhook dedupe fails open
`hasRecordedBillingEvent()` returns `false` whenever the REST call isn't `ok` (network error, 500), so a transient outage re-processes an already-applied webhook. `recordBillingEvent` treating 409 as success is fine, but the combined guarantee is weaker than the code reads.

### 15. `handleWipeData` is not a wipe
Deletes `expenses`, `asset_adjustments`, `bundles`, `sandbox_sheets`, `closed_months` — but not `email_reminder_queue` (recipient email + full HTML of every reminder), `support_tickets` (email + message), `profiles.expense_meta`, `monthly_boosts`, `wealth_objectives`, or `billing_webhook_events`. The copy says "permanently delete all your financial data … cannot be undone", which overstates it.

### 16. Two sources of truth, "non-empty DB wins"
```js
const mergedBoosts = Object.keys(dbBoosts).length > 0 ? dbBoosts : localBoosts;
const mergedObjectives = dbObjectives.length > 0 ? dbObjectives : localObjectives;
```
Delete your last boost/objective on device A and it's resurrected on the next load, because empty DB values mean "never written". No tombstone or version field distinguishes the two cases.

### 17. Non-React global mutable state
`window.__activeUserId` / `__fetchingUserId` / `__loadedUserId` are written in `App.jsx` and read in `SettingsTab.jsx`. Untyped, invisible to tooling, shared across same-origin tabs (two tabs on different accounts corrupt each other's staleness checks), and double-invoked under `StrictMode`.

### 18. `App.jsx` is the change bottleneck
~2,000 lines, ~30 draft `useState`s, ~120 props to `CashFlowTab`/`AIAssistantDrawer`. Every keystroke in an expense form re-renders the tree because drafts live beside the data. The autosave effect depends on `categories` and `sandboxSheets`, so one slider drag schedules a debounce that rewrites `profiles`, then one `UPDATE` per category **and one per sandbox sheet** — N+1 writes per second of idle.

### 19. Dead prop / dead test / dead code
`SettingsTab` uses `onBlur={handleUpdateProfile}` but `App.jsx` never passes it — salary saves only via the debounced autosave. `constants.test.js` uses `node:assert` but `package.json` has no `test` script and there is no CI. `runMoneyParserSelfTest` and `MONEY_PARSER_TEST_CASES` ship to production for a self-test nothing calls.

### 20. i18n is half done
Four locales exist, yet much of `aiAgentEngine.js` replies in hard-coded English (the whole "where/how do I" help section, most error strings), as do `SupportTab` placeholders and the Dev/Owner dashboards. FR/ES/AR users get English exactly on the hardest-to-guess branches.

### 21. Username validation is inconsistent
`Auth.jsx`: 3–20 chars, no spaces, `/^[a-zA-Z0-9_]+$/`. `sanitizeUsername()`: NFKC-normalises, strips bidi controls, allows 32 chars — and `App.jsx` applies it when self-healing a missing profile, so a user can end up with a name signup would reject. Uniqueness relies on a pre-flight RPC (race window before `signUp`).

### 22. Missing environment contract
`createClient(import.meta.env.VITE_SUPABASE_URL, …)` with no validation: a fresh clone without `.env` fails confusingly at runtime. No `.env.example`, and `README.md` is still the untouched Vite template (it documents Oxc/SWC plugins, not this app).

### 23. Bundle/emoji coupling
Names are built with a literal ` ` prefix in several places and stripped in only one in `excelGenerator.js` (`.replace('✨ ', '')`, non-global, space-sensitive). That literal flows into Excel and CSV output.

### 24. Minor nits
No `minLength` on password inputs outside the recovery modal; no `try/catch` around `roundRect`; `fetchUserData` inserts a `profiles` row from the client (two tabs race to a duplicate key, swallowed via the `!profile` path); 2026 tax brackets will silently age; `chunkSizeWarningLimit: 1000` masks regressions from ExcelJS + Transformers.js.

---

## What it does well (don't regress)

Consistent optimistic-update-with-rollback plus `.select()` verification on every mutation (so a silent RLS rejection is caught); HMAC constant-time compare with event dedupe and refund idempotency markers; stale-account guards in `billingService.js` and `billingStateEpochRef` so a slow profile read can't overwrite a newer billing action; a genuinely careful parser-based HTML sanitizer; Excel/CSV formula-injection neutralisation; every `localStorage` access wrapped in `try/catch`.

## Suggested reading order

1. `src/App.jsx` — `fetchUserData`, `handleCloseMonth`, `getCategoryAvailablePool`, the autosave effect.
2. `src/utils/constants.js` — date helpers define the string-date invariants everything relies on.
3. `src/utils/aiAgentEngine.js` (first ~300 lines + quota block) — exactly how much of Sterling is regex.
4. `supabase/functions/billing-manager/index.ts` — the only place money actually moves.
5. `src/components/SettingsTab.jsx` — the `subscription_status` state machine (`free`, `active`, `canceled_pending_expiry`, `refund_pending`, `refund_cancel_pending`, `refunded`, `expired`).
6. `src/utils/emailReminderService.js` — the repo's async dedupe style (`sent` / `not_sent` / `unverified`).

## Highest-value fixes, in order

1. Commit the SQL: schema + RLS + the six RPCs.
2. Revoke client writes to `profiles.role`, `subscription_*`, `pro_features_used`, `has_claimed_refund`.
3. Move month close into one Postgres function.
4. Remove the temp-UUID `updateExpenseMeta` call in `handleAddExpense`.
5. Add `isReadOnly` guards to `handleAddAdjustment`, `handleAddSubBucket`, `handleAddSandboxExpense`.
6. Fix `daily` forwarding on month close; respect skipped periods.
7. Reconcile the CSP with `index.html` (hash, `'unsafe-inline'`, or move the script to a module).
8. Add a server-side per-user email send cap.
9. Real `README.md` + `.env.example`; add a `test` script that runs `constants.test.js`.