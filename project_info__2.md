# Final Re-Evaluation — what's closed, what's still exploitable

Re-evaluated against your answers. Nothing in the project was touched.

**Verification caveat:** I can only read the repo. When I scanned it there was **no `supabase/migrations/`** — you say `0001_initial_schema.sql` was exported afterwards, so I cannot see it. Items marked **[verify]** are the pivot points and stay open until you paste the function bodies.

---

## 1. Now CLOSED — stop spending time here

| Original | Closed by |
|---|---|
| Client writes to `role` / `subscription_tier` / `subscription_*` / `has_claimed_refund` | `prevent_role_and_tier_tampering()` + column grants |
| CSP blocks the inline favicon script | Move to `public/favicon-init.js` — correct, no header change needed |
| Transformers.js model/WASM origins | Your `connect-src` / `worker-src` set is sufficient |
| `ctx.roundRect` throw | Cosmetic |
| SPA deep links / `_headers` on Cloudflare Pages | Pages applies `_headers` and falls back to `index.html` |
| Cross-tenant reads on `profiles`, `categories`, `expenses`, `bundles`, `sandbox_sheets`, `asset_adjustments`, `closed_months` | Per-table `USING / WITH CHECK (auth.uid() = user_id)` |
| `delete_user_account` param injection | Zero-arg + `auth.uid()` |
| `check_username_available` TOCTOU | Unique index + `handle_new_user` |
| `VITE_EMAIL_WEBHOOK_URL` bypass | Confirmed unset |
| Webhook `user_id` spoofing via provider metadata | `request_id` / `metadata.user_id` set server-side from the JWT |
| `Access-Control-Allow-Origin: *` | Not CSRF (bearer token, not cookies) |
| `X-Frame-Options` + `frame-ancestors` redundancy | Deliberate back-compat |
| AI quota in localStorage | Accepted (zero marginal cost, no API) |
| Logout account-switch state bleed | Existing `billingStateEpochRef` + `isStale()` guards |

---

## 2. CRITICAL

### C1 — Owner RPCs are executable by *every* authenticated customer; safety rests on a guard I can't see **[verify]**
**Location:** DB functions called from `src/components/OwnerDashboard.jsx` — `get_all_profiles_for_owner`, `get_saas_metrics_for_owner`, `owner_update_user_profile`.

**Why still Critical:** your A2/A3 answers say what these functions *must* do ("Must verify `role='owner'`", "the right pattern is…"), and G2 says only that the schema was **dumped**. `EXECUTE … GRANTED TO authenticated` makes all three callable by any logged-in customer. If the internal check is missing or runs after the write:

- `owner_update_user_profile(<own id>, 'owner', 'pro')` → Owner Command Center, permanent free Pro, and the power to promote/demote every account. **Complete auth bypass.**
- `get_all_profiles_for_owner()` → bulk export of every user's `email`, `username`, `salary`, `currency`, `subscription_*`. **Reportable PII breach.**

**Minimal fix (verify, don't rebuild).** Each function must open with:
```sql
IF NOT EXISTS (
  SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'owner'
) THEN
  RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
END IF;
```
plus `SET search_path = public` and `REVOKE EXECUTE ON FUNCTION … FROM PUBLIC, anon;`.
Then probe live: from a normal account, call all three — they must return 42501. **Do this before anything else on this list.**

---

## 3. HIGH

### H1 — Refund exploit: `pro_features_used` is still only set by a client RPC
**Location:** `src/App.jsx → markProFeatureUsed()` / `syncPendingProFeatureUsage()`; `supabase/functions/billing-manager/index.ts → request_refund` (`if (profile.pro_features_used)`).

**Exploit:** subscribe → use unlimited categories, ≥2 sandbox sheets, ≥2 wealth objectives, Excel exports → never call `mark_pro_feature_used` (or block it in DevTools; `syncPendingProFeatureUsage` swallows failure in a bare `catch {}`) → server still reads `pro_features_used = false` → `request_refund` issues a **full provider refund** inside 2 h. `has_claimed_refund` only limits it to once per account; new accounts repeat it.

**Fix (minimal):** inside `request_refund`, derive usage server-side before the eligibility block:
```sql
SELECT (count(*) FILTER (WHERE true) > 3) FROM categories WHERE user_id = …  -- etc.
```
Reject if any of: `categories > 3`, `sandbox_sheets > 1`, `jsonb_array_length(wealth_objectives) > 1`. Permanent fix: `BEFORE INSERT` triggers on both tables + `BEFORE UPDATE` on `profiles.wealth_objectives` that set the latch.

### H2 — Pro limits are still not enforced in the database at all
**Location:** `App.jsx` → `handleAddCategory` (`categories.length >= 3`), `handleCreateSandboxSheet` (`sandboxSheets.length >= 1`), `handleCreateWealthObjective` (`wealthObjectives.length >= 1`), `onDirectCreateCategory`, `onDirectCreateSandbox` — all `hasProAccess` in the browser.

**Exploit:** with only `auth.uid() = user_id` RLS, a Free user inserts 40 `categories` or 10 `sandbox_sheets` directly. Worse: **`wealth_objectives` is in your client `GRANT UPDATE` list**, so they can write 50 objectives without any trigger firing. The free/paid boundary is entirely decorative.

**Fix:** three `BEFORE` triggers, one per table, raising an exception past the free-tier allowance, all `service_role`-aware so the billing functions and admin tools aren't blocked.

### H3 — `handleCloseMonth` still non-transactional → two unrecoverable money-losing paths
**Location:** `src/App.jsx → handleCloseMonth`, steps 1–5. The `catch` resets only React state.

1. **Permanent deletion:** step 1 deletes every batched expense row, *then* inserts the aggregate. If the insert fails (network, RLS, constraint) the originals are gone forever.
2. **Double-counted wealth:** if the `asset_adjustments` insert (step 3) succeeds but `closed_months` (step 5) fails, the user retries and the wealth sweep runs **again** → lifetime portfolio inflated twice.

**Fix:** one `close_month(p_month text)` RPC performing all five steps in a single transaction, returning the new state (`closed_months` row, forwarded recurring rows, adjustments) so `App.jsx` just replaces state. Do not go live with payments before this ships.

### H4 — Webhook dedupe is still "check → mutate → record", and the record result is discarded
**Location:** `billing-manager/index.ts` — `hasRecordedBillingEvent()` returns `false` on any non-`ok` REST response; `await recordBillingEvent(...)` boolean is **never checked**; the profile PATCH happens between them.

**Failure:** a transient Supabase REST error during the pre-check fails open, so a provider retry re-applies the event. The stale guard uses `subscription_updated_at.lte.<eventTime>`, which permits *equal* timestamps, so a byte-identical redelivery re-runs the whole branch.

**Fix:** claim first, apply second.
1. `POST billing_webhook_events` with `Prefer: resolution=ignore-duplicates,return=representation`.
2. 0 rows / 409 → `200 {duplicate:true}`.
3. DB 5xx → `500` so the provider retries safely.
4. Apply the profile patch; on failure delete the `event_id` row before returning 500.
Requires `UNIQUE (event_id)`.

### H5 — Refund succeeds at the provider while the profile patch matches 0 rows
**Location:** `billing-manager/index.ts → request_refund`, STEP 3 — `updateProfileBillingRow({ userId, subscriptionId: subId || undefined, … })` appends `&subscription_id=eq.<subId>`.

**Failure:** if the profile's `subscription_id` changed since (a refund webhook, a re-subscribe, or `resolveCreemTransactionIdFromSubscription` writing a different id), the PATCH updates nothing → `ok:false` → 500 "refund succeeded, but updating your profile failed". **`has_claimed_refund` is set inside that same failing PATCH**, so the account keeps the refund *and* keeps Pro until the user manually retries. A user who never retries keeps Pro indefinitely.

**Fix:** key the terminal revocation PATCH on `user_id` only (drop `subscriptionId`), and write `has_claimed_refund` in a separate statement that cannot be filtered out.

### H6 — Legitimate 2-hour refunds get denied when `subscription_started_at` is never written
**Location:** `billing-manager/index.ts` — `subscription_started_at` is only set when `isInitialCreation && !isSameExistingSubscription`; `isInitialCreation` is true only for `checkout.completed` / `subscription.active` (Creem) and `subscription_created` (Lemon).

**Failure:** a subscription whose first delivered event is `subscription.updated` / `subscription.paid` leaves `subscription_started_at` NULL → `Date.parse(null)` → `NaN` → server rejects with "the 2-hour unused refund window has expired"; client-side `SettingsTab.isWithinTwoHours` is also false, so **the button never renders**. Outcome: chargebacks and support tickets from exactly the customers your policy is meant to reassure.

**Fix:** fall back to `created_at`/event time when the field is absent, and let the server treat a missing start as "window open — verify with provider" rather than "expired".

### H7 — `send-recurring-reminder` still accepts client HTML and has no per-user cap
You agreed (C1/C2); it is still live. Any authenticated user can loop the function and burn Resend quota / sender reputation. The sanitizer is careful but hand-rolled HTML allowlisting is the wrong shape for webmail clients (CSS `position`/`behavior` in `style`).

**Fix:** accept only structured items (`[{name, cost, expense_date, category}]`), render the template inside the function with strict entity escaping, check `UNIQUE (user_id, recurrence_cycle, period_key)` before calling Resend, and cap sends per user per hour.

### H8 — `handleDeleteCategory` will break the moment you add `ON DELETE RESTRICT`
**Location:** `src/App.jsx → handleDeleteCategory` — deletes the `categories` row, removes expenses from React state only.

**Failure:** with RESTRICT, deleting any category that has at least one expense throws FK `23503`; the UI rolls back with "Failed to delete category", so **category deletion stops working entirely** for used categories.

**Fix:** one `delete_category(p_category_id)` RPC that reassigns its expenses to an "Uncategorized" row (creating it if needed), redistributes the freed percentage proportionally so the sum stays exactly 100, then deletes — in one transaction.

---

## 4. Deploy-blocking interactions with the new grants (not exploitable, but break prod day one)

### D1 — `fetchUserData`'s self-heal INSERT starts failing with 42501
`src/App.jsx → fetchUserData`:
```js
supabase.from('profiles').insert([{ user_id, username, role: 'user', subscription_tier: 'free' }])
```
`role` and `subscription_tier` are **not** in your `GRANT INSERT (…)` list → `permission denied for table profiles`. Once `handle_new_user` exists, delete both fields from this payload (or remove the branch).

### D2 — `DevDashboard` and `OwnerDashboard` do `select('*')` on `support_tickets` with no filter
Both depend on staff RLS returning *all* rows. Your A8 answer gives customers scoped SELECT plus a staff policy. If `is_staff()` covers only `owner`, the **Dev Dashboard goes blank**; if the staff policy is missing, the **Owner Dashboard goes blank**. `DevDashboard` also issues `UPDATE` and `DELETE` on arbitrary tickets — those need staff policies too.

### D3 — Autosave upsert is compatible with your grants (no action needed)
`user_id, salary, currency, tax_country, tax_filing_status, monthly_boosts, wealth_objectives, email_reminders_enabled, last_reminder_period` all appear in both grant lists; `emailReminderService`'s `{user_id, last_reminder_period}` upsert is fine.

### D4 — `pro_features_used` in the client `GRANT UPDATE` list is a footgun
The one-way latch blocks `true → false`, but it lets a user set it **true** and permanently lock themselves out of a legitimate refund. Prefer removing it from the client grant list and exposing it only through `mark_pro_feature_used` (SECURITY DEFINER).

---

## 5. Single-pass patch order

1. **Verify C1 live** — call all three owner RPCs from a normal account; expect 42501. Launch-blocking.
2. **Unset `ALLOW_SANDBOX_SIMULATION`** now; add the `role IN ('owner','dev')` fallback if you want to keep sandbox testing.
3. Ship `close_month()` and swap `handleCloseMonth` to one call (**H3**).
4. Ship `delete_category()` + switch `expenses.category_id` to RESTRICT (**H8**).
5. Server-side usage derivation in `request_refund` (**H1**), then the three Pro-limit triggers (**H2**).
6. `billing-manager`: claim-then-apply dedupe (**H4**), `user_id`-only revocation PATCH (**H5**), `subscription_started_at` fallback (**H6**).
7. `send-recurring-reminder`: structured payload + `UNIQUE` + rate limit (**H7**).
8. Fix the profile-insert payload and confirm staff RLS (**D1**, **D2**); drop `pro_features_used` from the client grant (**D4**).
9. Only then wire live Creem keys.

---

## 6. Still unverifiable without the migration file

- Bodies of `owner_update_user_profile`, `get_all_profiles_for_owner`, `get_saas_metrics_for_owner`, `mark_pro_feature_used`, `delete_user_account` — **C1 lives or dies here**.
- Whether `is_staff()` exists and which roles it covers (**D2**).
- Whether `email_reminder_queue` INSERT is still open to `authenticated`. If it is, a user can insert `status='sent'` rows for their own `user_id` and **silently suppress their own future reminders** (self-inflicted, medium) — but it also makes your "reminder sent" audit trail untrustworthy for billing disputes.
- Column types for `expenses.cost` and `asset_adjustments.amount`. If either is `double precision` instead of `numeric`, rounding drift accumulates in the wealth sweep — a 10-second check worth doing.

Paste the migration's five function bodies and I can close C1 and D2 definitively.