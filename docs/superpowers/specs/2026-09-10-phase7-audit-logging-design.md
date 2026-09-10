# FMBRequestThali — Phase 7: Audit Logging Design

Source spec: `FMBRequestThali Web App — Complete Development Prompt.md` §27 (Audit Logging, ~line 1071), §58 build-sequence item 19, §59 checklist item "All administrative changes are auditable." Builds on Phase 1 (`audit_logs` table, `supabase/migrations/0005_audit_logs.sql`), Phase 2 (`approve_menu_version`/`reject_menu_version`, `supabase/migrations/0009_menu_approval_rpc.sql`), and every administrative write path shipped in Phases 3b-core, 3b-detail, 4, and 5 — all merged on `master`.

## Why this shape

Migration `0005`'s own comment already commits this project to a specific mechanism: "rows are written only by SECURITY DEFINER functions... running as the table owner, never via a direct client grant." Migration `0009` already built exactly that, twice — `approve_menu_version` and `reject_menu_version` each insert their own `audit_logs` row inline, with `actor_id = auth.uid()` set inside the function so a client can never spoof who performed the action. That pattern is proven, shipped, and working. This phase's job is to extend it to every other administrative write path, not invent a new mechanism.

Rather than rewriting each existing write path's business logic into a bespoke `SECURITY DEFINER` SQL function (which is what `approve_menu_version`/`reject_menu_version` do, because their business logic — status transitions, supersession — genuinely needed to run atomically under row locks), this phase adds one generic `log_audit_event(...)` function that does only the audit insert. Each existing Server Action calls it as an extra last step after its existing write(s) succeed. This keeps business logic exactly where this project has consistently kept it — in TypeScript Server Actions, not SQL — and avoids re-touching and re-risking already-shipped, already-reviewed code paths for marginal benefit. The tradeoff, accepted explicitly: for these paths the audit write is not atomic with the business write (unlike the two menu-approval RPCs, which remain the one place where write-and-audit happen in a single transaction). This mirrors the precedent already set by `notify()` in Phase 4 — a side-channel effect that follows a successful business write and does not roll it back if the side channel itself fails.

## Scope

**In Phase 7:**
- `supabase/migrations/0022_audit_log_event_rpc.sql` — `public.log_audit_event(p_action, p_entity_type, p_entity_id, p_previous_state, p_new_state, p_ip_address)`, `SECURITY DEFINER`, admin-gated, `grant execute ... to authenticated`
- `src/lib/audit/index.ts` — `logAuditEvent(supabase, params)` thin wrapper around the RPC call, plus `getRequestIp()` helper reading `x-forwarded-for` via `next/headers`
- Instrumentation of 6 existing Server Actions (see table below)
- `/super-admin/audit` — new read-only viewer page, `requireRole(['super_admin'])`
- A nav link from `/super-admin` to `/super-admin/audit`

**Explicitly not in Phase 7:**
- Rewriting `approve_menu_version`/`reject_menu_version` to call the new shared function — they already write correct audit rows inline; touching known-working, already-reviewed code for pure consistency is not worth the risk.
- **Leave changed** — no edit/delete action exists for `user_leaves` anywhere in the app; there is nothing to instrument.
- **App setting changed** — `src/lib/settings/index.ts` is read-only (`getSetting`/`getSettings`); no write path exists anywhere in `src/app`, and no `/super-admin/settings` page was ever built. Logging a write that doesn't exist isn't possible; building that settings UI is out of scope for an audit-logging phase.
- **Administrative request override** — spec says "if implemented"; it isn't, anywhere in this app.
- Logging `sendPasswordResetAction` — it writes no database row (only sends an email via Supabase auth); not in spec's event list.
- CSV/export of audit data — same "structured, exportable-shaped data is enough for now" reasoning Phase 6 applied to reports; the viewer renders a plain HTML table.
- Any modification to `/super-admin`'s existing two nav links, or to any existing page beyond the one new nav link.

## `log_audit_event` (migration `0022`)

```sql
create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_previous_state jsonb default null,
  p_new_state jsonb default null,
  p_ip_address text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin or super_admin may write an audit log entry';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, ip_address)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_previous_state, p_new_state, p_ip_address);
end;
$$;

grant execute on function public.log_audit_event(text, text, text, jsonb, jsonb, text) to authenticated;
```

`public.is_admin()` (defined in `0002_profiles_rls.sql`) is reused as-is — it already returns true for both `admin` and `super_admin`, matching who can actually reach the six instrumented Server Actions (`requireRole(['admin', 'super_admin'])` or `requireRole(['super_admin'])`, all of which already ran before this RPC is ever called). The in-function check is defense-in-depth, not the primary gate — mirrors `approve_menu_version`'s own `is_super_admin()` check.

## `src/lib/audit/index.ts`

```ts
import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditEventParams = {
  action: string;
  entityType: string;
  entityId: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
};

export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

export async function logAuditEvent(
  supabase: SupabaseClient,
  params: AuditEventParams
): Promise<void> {
  const ip = await getRequestIp();
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: params.action,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId,
    p_previous_state: params.previousState ?? null,
    p_new_state: params.newState ?? null,
    p_ip_address: ip,
  });
  if (error) {
    console.error('logAuditEvent failed', { action: params.action, entityType: params.entityType, entityId: params.entityId, error });
  }
}
```

`logAuditEvent` never throws — a failed audit write is logged server-side and swallowed, matching `notify()`'s established failure semantics (Phase 4). Every call site invokes it as the last step, after its business write has already succeeded and right before `redirect(...)`.

## Instrumentation (6 call sites)

| # | File | Action | `action` string | `entity_type` / `entity_id` | previous/new state |
|---|---|---|---|---|---|
| 1 | `src/app/(app)/admin/menu/new/actions.ts` | `createMenuAction` | `'menu_created'` | `'menu_version'` / new version id | `null` / `{ title, notes, itemCount }` |
| 2 | `src/app/(app)/admin/menu/[id]/actions.ts` | `updateMenuVersionAction` | `'menu_edited'` | `'menu_version'` / version id | `{ title, notes }` before / after |
| 2b | `src/app/(app)/admin/menu/[id]/actions.ts` | `createNewVersionAction` | `'menu_edited'` | `'menu_version'` / new version id | `null` / `{ title, notes, copiedFromVersionId }` |
| 3 | `src/app/(app)/admin/menu/[id]/actions.ts` | `submitForApprovalAction` | `'menu_submitted'` | `'menu_version'` / version id | `{ status: 'draft' or 'rejected' }` / `{ status: 'pending_approval' }` |
| 4 | `src/app/(app)/admin/leave/actions.ts` | `createLeaveAction` | `'leave_created'` | `'user_leave'` / new row id | `null` / `{ userId, fromDate, toDate, reason }` |
| 5 | `src/app/(app)/super-admin/service-holidays/actions.ts` | `createServiceHolidayAction` | `'service_holiday_created'` | `'service_holiday'` / new row id | `null` / `{ serviceDate, reason }` |
| 6 | `src/app/(app)/admin/concerns/[id]/actions.ts` | `replyToConcernAction` | `'concern_status_changed'` | `'concern'` / concern id | `{ status: <old> }` / `{ status: <new> }` |
| 7 | `src/app/(app)/super-admin/users/actions.ts` | `inviteUserAction` | `'user_created'` | `'profile'` / new user id | `null` / `{ fullName, email, userCode, role }` |
| 8 | `src/app/(app)/super-admin/users/[id]/actions.ts` | `updateUserAction` | up to 3 rows: `'user_edited'`, `'user_activated'`/`'user_deactivated'`, `'role_changed'` | `'profile'` / target id | see below |

**Row #6** requires fetching the concern's current `status` before the update — `replyToConcernAction` already fetches the `concern` row (for `user_id`); extend that `select` to include `status` too, no extra query.

**Row #8 (`updateUserAction`)** is the one action that can change several independent things in a single submit. It already fetches the current row for the self-lock check, but only when `targetId === profile.id`; this phase extends that fetch (`role, active, full_name, mobile, email`) to run unconditionally before the update, since the audit trail needs the previous state regardless of who the target is. After the update succeeds, compare old vs. new and emit one `logAuditEvent` call per changed aspect:
- `full_name`, `mobile`, or `email` changed → `'user_edited'`, `previousState`/`newState` scoped to just the fields that changed
- `active` changed → `'user_activated'` (if now `true`) or `'user_deactivated'` (if now `false`), `{ active: <old> }` / `{ active: <new> }`
- `role` changed → `'role_changed'`, `{ role: <old> }` / `{ role: <new> }`

If none of those changed (a no-op submit), no audit row is written — an audit log for "nothing changed" is noise, not a trace of an administrative change.

**Row #2b**: `createNewVersionAction`'s existing report/plan context establishes it creates a new draft version, optionally copying items from the currently-approved version — classified as `'menu_edited'` (not a distinct third event) since spec §27 lists only Created/Edited/Submitted/Approved/Rejected for menus, and a new draft version is a variant of "edited," not a new menu.

## `/super-admin/audit`

`requireRole(['super_admin'])` — deliberately stricter than every other Phase 7 write path (`admin` and `super_admin` can both *write* audit rows via the actions above; only `super_admin` can *read* them back). This matches `audit_logs`'s existing `audit_logs_select_super_admin` RLS policy from migration `0005` exactly — no RLS change needed in this phase.

Query shape follows this project's established two-query-no-embed pattern: one query against `audit_logs` (optionally filtered by `searchParams.entityType`, `searchParams.action`, `searchParams.from`/`searchParams.to`, each an exact-match/range predicate — no free-text search), capped at the 200 most recent rows when no filter narrows it; a second query resolves the distinct `actor_id`s present in that page against `profiles` (`id, full_name, user_code`), joined in application code. Every Supabase query is error-checked before use, red-banner error state on failure — the same discipline flagged repeatedly this session.

Rendered as a table: timestamp, actor (`full_name` / `user_code`, falling back to the raw `actor_id` if the profile lookup somehow misses), action, entity type + id, and an expandable `<details>` per row showing `previous_state`/`new_state` as formatted JSON (both may be `null`, rendered as `—`). "No matching audit records for this filter." empty state, matching this app's established phrasing. Filter inputs above the table: a `<select>` for `entityType` (options: the entity types this phase actually writes — `menu_version`, `profile`, `user_leave`, `service_holiday`, `concern`), a `<select>` for `action` (the 10 action strings this phase writes, plus `menu_approved`/`menu_rejected` from the existing Phase 2 RPCs), and `from`/`to` date inputs.

Nav link: `src/app/(app)/super-admin/page.tsx`'s existing single `<div className="mt-4 flex flex-wrap gap-3">` block gets a fourth link, "Audit Log" → `/super-admin/audit`, alongside the existing three.

## Error handling

- Every `logAuditEvent` call: failure is caught inside the helper itself (never throws), logged via `console.error`, and never blocks the calling Server Action's redirect — the business change already happened and is real; the audit trail is a best-effort side channel, same as `notify()`.
- `/super-admin/audit` page: any Supabase query error shows the established red-banner error state, never a silently empty or fabricated table.
- `log_audit_event`'s own `is_admin()` guard: raises a Postgres exception if somehow called by a non-admin session. Since every call site is already gated by `requireRole` before it's ever reached, this should be unreachable in normal operation — it exists purely as defense-in-depth, matching `approve_menu_version`'s identical pattern.

## Testing

- Unit tests: none needed for `logAuditEvent` itself beyond what integration tests below cover — it's a thin RPC wrapper with no branching logic worth unit-testing in isolation (the "which aspects changed" comparison logic in `updateUserAction` is the one piece of real logic this phase adds, and it's covered by an integration test below rather than a unit test, since its correctness depends on the real before/after DB state).
- Integration tests, new file `src/lib/supabase/audit-log-rls.integration.test.ts` (same `describe.skipIf(skip)` style as `concerns-notifications-rls.integration.test.ts`):
  - An authenticated `admin` client calling `createLeaveAction`'s underlying insert + `log_audit_event` RPC directly produces a `user_leave`-typed row with `actor_id` equal to that admin's own id — even when a spoofed `p_ip_address` or attempted actor override is passed, `actor_id` is always the caller's own `auth.uid()`.
  - A negative control: an authenticated ordinary `user` client calling `log_audit_event` directly is rejected (the `is_admin()` guard fires).
  - A negative control: an authenticated `admin` (not `super_admin`) client querying `audit_logs` directly gets zero rows back (RLS), even though that same admin can successfully *write* one via the RPC — proving the write/read asymmetry is real, not just a UI-level restriction.
  - `updateUserAction`'s multi-aspect logic: seed a user, change both `role` and `active` in one call, assert exactly two `audit_logs` rows are written (`role_changed` and `user_activated`/`user_deactivated`), each with correctly scoped previous/new state — and a no-op update (no fields actually changed) writes zero rows.
- No new tests for `/super-admin/audit`'s RLS — it reads through `audit_logs_select_super_admin`, already covered by whatever test (if any) exists from Phase 1; if none does, this phase's integration test file above adds the super_admin-can-read / admin-cannot-read coverage that policy was always missing.

## Seed data

None needed — every instrumented action already has a seeded, reachable path (an existing admin/super_admin user, an existing menu draft, an existing leave-eligible user, etc.) from earlier phases' seed data. The `/super-admin/audit` viewer will simply be empty until an admin performs one of the six instrumented actions in the running dev environment, which is the correct, honest empty state for a viewer of an event log with no history yet.
