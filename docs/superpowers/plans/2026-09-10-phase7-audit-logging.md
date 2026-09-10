# FMBRequestThali — Phase 7: Audit Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every administrative write path in the app writes a traceable, unspoofable `audit_logs` row, and a new `/super-admin/audit` page lets a super_admin browse and filter that trail.

**Architecture:** One new `SECURITY DEFINER` SQL function, `public.log_audit_event(...)`, does the audit insert with `actor_id = auth.uid()` set inside the function (unspoofable from the client) — the same mechanism migration `0009`'s `approve_menu_version`/`reject_menu_version` already use successfully. A thin TypeScript wrapper (`src/lib/audit/index.ts`) calls that RPC and never throws (fire-and-forget, matching `notify()`'s established failure semantics). Six existing Server Actions across 6 files gain one or more calls to that wrapper, inserted as the last step before their existing `redirect(...)`. A new read-only page renders the trail for `super_admin` only, matching `audit_logs`'s existing RLS.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + RLS + `SECURITY DEFINER` functions), Zod, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-phase7-audit-logging-design.md`

## Global Constraints

- `logAuditEvent` never throws. Every call site is fire-and-forget: on RPC failure it `console.error`s and returns — it must never block or fail the action's own redirect, because the real administrative change already succeeded and is real.
- `log_audit_event`'s `is_admin()` check inside the SQL function is defense-in-depth only, never the primary authorization gate — every call site already passed `requireRole(['admin', 'super_admin'])` or `requireRole(['super_admin'])` before ever reaching the audit call.
- Any new Zod schema or `FormData.get(...)` handling in this phase must use `.nullable().optional()` for fields that may be absent — `FormData.get()` returns `null`, never `undefined`, for a missing field (this exact bug has recurred multiple times this project).
- Any new multi-table Supabase query in this phase must never embed two tables with more than one foreign-key path to each other in a single `.select()` (PGRST201 ambiguous embed) — query separately and join in application code (the "two-query-no-embed" pattern already used throughout `/admin/reports/*`).
- Every new or touched Supabase query destructures and checks `error` before using `data`, and any page shows a visible red-banner error state on failure — never a silently fabricated empty/zero result.
- `inviteUserAction` is the one file in this codebase with a `service_role` Supabase client. The audit call in that file MUST use an ordinary, cookie-based, session-scoped client (`createServerSupabaseClient()`), never the service-role client — a `service_role` JWT has no `auth.uid()`, so calling `log_audit_event` through it would silently write a row with `actor_id = null` instead of the inviting super_admin's own id.
- `updateUserAction`'s fetch of the target's current `profiles` row must happen unconditionally, for every target, not only when `targetId === profile.id` (the prior self-lock-only condition) — the audit trail needs a previous-state snapshot for every edit, regardless of who the target is.
- No worktree — this session works directly on `master`, per established convention for this entire project.
- Never edit an already-committed, already-applied migration file in place. If a defect is found in a prior migration during this phase's work, fix it forward with a new migration, never by editing the old one.

---

### Task 1: `log_audit_event` SQL function

**Files:**
- Create: `supabase/migrations/0022_audit_log_event_rpc.sql`

**Interfaces:**
- Produces: `public.log_audit_event(p_action text, p_entity_type text, p_entity_id text, p_previous_state jsonb default null, p_new_state jsonb default null, p_ip_address text default null) returns void` — callable via `supabase.rpc('log_audit_event', {...})` from any `authenticated` session where `public.is_admin()` is true.

- [ ] **Step 1: Write the migration**

```sql
-- 0022_audit_log_event_rpc.sql
-- Generic audit-insert function extending the SECURITY DEFINER pattern
-- already proven by approve_menu_version/reject_menu_version (0009):
-- actor_id is always auth.uid(), set inside the function, never
-- client-supplied — a client cannot spoof who performed an action.

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

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: completes with no errors (this also reapplies all prior migrations and reseeds — the standard way migrations have been verified throughout this project).

- [ ] **Step 3: Verify the function exists and is owned correctly**

Run: `npx supabase db query "select prosecdef from pg_proc where proname = 'log_audit_event'"`
Expected: one row, `prosecdef = t` (confirms `SECURITY DEFINER` took effect).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0022_audit_log_event_rpc.sql
git commit -m "feat: add log_audit_event SECURITY DEFINER function"
```

---

### Task 2: Audit logging TypeScript module

**Files:**
- Create: `src/lib/audit/index.ts`

**Interfaces:**
- Consumes: `public.log_audit_event` RPC from Task 1.
- Produces: `logAuditEvent(supabase: SupabaseClient, params: AuditEventParams): Promise<void>` and `getRequestIp(): Promise<string | null>`, both imported by every task from here on that instruments a Server Action.
  ```ts
  export type AuditEventParams = {
    action: string;
    entityType: string;
    entityId: string;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
  };
  ```

- [ ] **Step 1: Write the module**

```ts
// src/lib/audit/index.ts
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
    console.error('logAuditEvent failed', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      error,
    });
  }
}
```

`headers()` from `next/headers` is async in this Next.js version — confirmed by the existing `await cookies()` usage in `src/lib/supabase/server.ts`, which is the same request-scoped API family.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audit/index.ts
git commit -m "feat: add logAuditEvent helper wrapping log_audit_event RPC"
```

---

### Task 3: Instrument menu actions (4 call sites, 2 files)

**Files:**
- Modify: `src/app/(app)/admin/menu/new/actions.ts`
- Modify: `src/app/(app)/admin/menu/[id]/actions.ts`

**Interfaces:**
- Consumes: `logAuditEvent` from Task 2 (`@/lib/audit`).

This task is mechanical: one `logAuditEvent` call added right before each action's final success `redirect(...)`, using data the function already has in scope. No new queries except where noted.

- [ ] **Step 1: `createMenuAction` — log `'menu_created'`**

In `src/app/(app)/admin/menu/new/actions.ts`, add the import:

```ts
import { logAuditEvent } from '@/lib/audit';
```

Change the end of the function from:

```ts
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=items_save_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}
```

to:

```ts
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=items_save_failed`);
  }

  await logAuditEvent(supabase, {
    action: 'menu_created',
    entityType: 'menu_version',
    entityId: version!.id,
    newState: {
      title: parsed.data.title || null,
      notes: parsed.data.notes || null,
      itemCount: itemRows.length,
    },
  });

  redirect(`/admin/menu/${menuId}`);
}
```

- [ ] **Step 2: `updateMenuVersionAction` — log `'menu_edited'` with before/after title+notes**

In `src/app/(app)/admin/menu/[id]/actions.ts`, add the import at the top:

```ts
import { logAuditEvent } from '@/lib/audit';
```

Change:

```ts
  const supabase = await createServerSupabaseClient();

  const { error: updateError } = await supabase
    .from('menu_versions')
    .update({ title: parsed.data.title || null, notes: parsed.data.notes || null })
    .eq('id', versionId);
```

to:

```ts
  const supabase = await createServerSupabaseClient();

  const { data: previousVersion } = await supabase
    .from('menu_versions')
    .select('title, notes')
    .eq('id', versionId)
    .maybeSingle();

  const { error: updateError } = await supabase
    .from('menu_versions')
    .update({ title: parsed.data.title || null, notes: parsed.data.notes || null })
    .eq('id', versionId);
```

Then change the end of `updateMenuVersionAction` from:

```ts
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}

export async function submitForApprovalAction(formData: FormData) {
```

to:

```ts
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  await logAuditEvent(supabase, {
    action: 'menu_edited',
    entityType: 'menu_version',
    entityId: versionId,
    previousState: previousVersion ? { title: previousVersion.title, notes: previousVersion.notes } : null,
    newState: { title: parsed.data.title || null, notes: parsed.data.notes || null },
  });

  redirect(`/admin/menu/${menuId}`);
}

export async function submitForApprovalAction(formData: FormData) {
```

- [ ] **Step 3: `submitForApprovalAction` — log `'menu_submitted'` with before/after status**

Change:

```ts
  const { data: existingItems, error: itemsCheckError } = await supabase
    .from('menu_items')
    .select('id')
    .eq('menu_version_id', versionId)
    .limit(1);

  if (itemsCheckError) {
    redirect(`/admin/menu/${menuId}?error=submit_failed`);
  }

  if (!existingItems || existingItems.length === 0) {
    redirect(`/admin/menu/${menuId}?error=no_items`);
  }

  const { error } = await supabase
    .from('menu_versions')
    .update({
      status: 'pending_approval',
      submitted_by: profile.id,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', versionId)
    .in('status', ['draft', 'rejected']);

  if (error) {
    redirect(`/admin/menu/${menuId}?error=submit_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}

export async function createNewVersionAction(formData: FormData) {
```

to:

```ts
  const { data: existingItems, error: itemsCheckError } = await supabase
    .from('menu_items')
    .select('id')
    .eq('menu_version_id', versionId)
    .limit(1);

  if (itemsCheckError) {
    redirect(`/admin/menu/${menuId}?error=submit_failed`);
  }

  if (!existingItems || existingItems.length === 0) {
    redirect(`/admin/menu/${menuId}?error=no_items`);
  }

  const { data: previousVersion } = await supabase
    .from('menu_versions')
    .select('status')
    .eq('id', versionId)
    .maybeSingle();

  const { error } = await supabase
    .from('menu_versions')
    .update({
      status: 'pending_approval',
      submitted_by: profile.id,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', versionId)
    .in('status', ['draft', 'rejected']);

  if (error) {
    redirect(`/admin/menu/${menuId}?error=submit_failed`);
  }

  await logAuditEvent(supabase, {
    action: 'menu_submitted',
    entityType: 'menu_version',
    entityId: versionId,
    previousState: { status: previousVersion?.status ?? null },
    newState: { status: 'pending_approval' },
  });

  redirect(`/admin/menu/${menuId}`);
}

export async function createNewVersionAction(formData: FormData) {
```

- [ ] **Step 4: `createNewVersionAction` — log `'menu_edited'` for the new draft version**

Change the end of the function from:

```ts
    if (approvedItems && approvedItems.length > 0) {
      const itemRows = approvedItems.map((item) => ({
        menu_version_id: newVersion!.id,
        item_name: item.item_name,
        category: item.category,
        description: item.description,
        display_order: item.display_order,
      }));
      const { error: copyItemsError } = await supabase.from('menu_items').insert(itemRows);
      if (copyItemsError) {
        redirect(`/admin/menu/${menuId}?error=already_active`);
      }
    }
  }

  redirect(`/admin/menu/${menuId}`);
}
```

to:

```ts
    if (approvedItems && approvedItems.length > 0) {
      const itemRows = approvedItems.map((item) => ({
        menu_version_id: newVersion!.id,
        item_name: item.item_name,
        category: item.category,
        description: item.description,
        display_order: item.display_order,
      }));
      const { error: copyItemsError } = await supabase.from('menu_items').insert(itemRows);
      if (copyItemsError) {
        redirect(`/admin/menu/${menuId}?error=already_active`);
      }
    }
  }

  await logAuditEvent(supabase, {
    action: 'menu_edited',
    entityType: 'menu_version',
    entityId: newVersion!.id,
    newState: {
      copiedFromVersionId: menu?.current_approved_version_id ?? null,
    },
  });

  redirect(`/admin/menu/${menuId}`);
}
```

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/admin/menu/new/actions.ts" "src/app/(app)/admin/menu/[id]/actions.ts"
git commit -m "feat: audit-log menu created/edited/submitted actions"
```

---

### Task 4: Instrument leave, service-holiday, concern-reply, and invite-user actions

**Files:**
- Modify: `src/app/(app)/admin/leave/actions.ts`
- Modify: `src/app/(app)/super-admin/service-holidays/actions.ts`
- Modify: `src/app/(app)/admin/concerns/[id]/actions.ts`
- Modify: `src/app/(app)/super-admin/users/actions.ts`

**Interfaces:**
- Consumes: `logAuditEvent` from Task 2 (`@/lib/audit`).

- [ ] **Step 1: `createLeaveAction` — log `'leave_created'`**

In `src/app/(app)/admin/leave/actions.ts`, add the import:

```ts
import { logAuditEvent } from '@/lib/audit';
```

Change:

```ts
  const { error } = await supabase.from('user_leaves').insert({
    user_id: parsed.data.userId,
    from_date: parsed.data.fromDate,
    to_date: parsed.data.toDate,
    reason: parsed.data.reason || null,
    entered_by: profile.id,
  });

  if (error) {
    redirect('/admin/leave?error=save_failed');
  }

  redirect('/admin/leave');
}
```

to:

```ts
  const { data: newLeave, error } = await supabase
    .from('user_leaves')
    .insert({
      user_id: parsed.data.userId,
      from_date: parsed.data.fromDate,
      to_date: parsed.data.toDate,
      reason: parsed.data.reason || null,
      entered_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !newLeave) {
    redirect('/admin/leave?error=save_failed');
  }

  await logAuditEvent(supabase, {
    action: 'leave_created',
    entityType: 'user_leave',
    entityId: newLeave!.id,
    newState: {
      userId: parsed.data.userId,
      fromDate: parsed.data.fromDate,
      toDate: parsed.data.toDate,
      reason: parsed.data.reason || null,
    },
  });

  redirect('/admin/leave');
}
```

- [ ] **Step 2: `createServiceHolidayAction` — log `'service_holiday_created'`**

In `src/app/(app)/super-admin/service-holidays/actions.ts`, add the import:

```ts
import { logAuditEvent } from '@/lib/audit';
```

Change:

```ts
  const { error } = await supabase.from('service_holidays').insert({
    service_date: parsed.data.serviceDate,
    reason: parsed.data.reason,
    created_by: profile.id,
  });

  if (error) {
    if (error.code === '23505') {
      redirect('/super-admin/service-holidays?error=duplicate');
    }
    redirect('/super-admin/service-holidays?error=save_failed');
  }

  redirect('/super-admin/service-holidays');
}
```

to:

```ts
  const { data: newHoliday, error } = await supabase
    .from('service_holidays')
    .insert({
      service_date: parsed.data.serviceDate,
      reason: parsed.data.reason,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !newHoliday) {
    if (error?.code === '23505') {
      redirect('/super-admin/service-holidays?error=duplicate');
    }
    redirect('/super-admin/service-holidays?error=save_failed');
  }

  await logAuditEvent(supabase, {
    action: 'service_holiday_created',
    entityType: 'service_holiday',
    entityId: newHoliday!.id,
    newState: { serviceDate: parsed.data.serviceDate, reason: parsed.data.reason },
  });

  redirect('/super-admin/service-holidays');
}
```

- [ ] **Step 3: `replyToConcernAction` — log `'concern_status_changed'` with before/after status**

In `src/app/(app)/admin/concerns/[id]/actions.ts`, add the import:

```ts
import { logAuditEvent } from '@/lib/audit';
```

Change:

```ts
  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('user_id')
    .eq('id', concernId)
    .maybeSingle();
```

to:

```ts
  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('user_id, status')
    .eq('id', concernId)
    .maybeSingle();
```

Then change the end of the function from:

```ts
  const notificationType: NotificationType = parsed.data.newStatus === 'resolved' ? 'concern_resolved' : 'concern_response';
  await notify(supabase, concern.user_id, notificationType, { concernId });

  redirect(`/admin/concerns/${concernId}`);
}
```

to:

```ts
  await logAuditEvent(supabase, {
    action: 'concern_status_changed',
    entityType: 'concern',
    entityId: concernId,
    previousState: { status: concern.status },
    newState: { status: parsed.data.newStatus },
  });

  const notificationType: NotificationType = parsed.data.newStatus === 'resolved' ? 'concern_resolved' : 'concern_response';
  await notify(supabase, concern.user_id, notificationType, { concernId });

  redirect(`/admin/concerns/${concernId}`);
}
```

- [ ] **Step 4: `inviteUserAction` — log `'user_created'` using an ordinary session client, NOT the service-role client**

In `src/app/(app)/super-admin/users/actions.ts`, add these imports:

```ts
import { logAuditEvent } from '@/lib/audit';
import { createServerSupabaseClient } from '@/lib/supabase/server';
```

Change the end of the function from:

```ts
  if (parsed.data.role !== 'user') {
    const { error: roleError } = await serviceClient
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', invited.user.id);
    if (roleError) {
      redirect('/super-admin/users?error=role_failed');
    }
  }

  redirect('/super-admin/users?invited=1');
}
```

to:

```ts
  if (parsed.data.role !== 'user') {
    const { error: roleError } = await serviceClient
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', invited.user.id);
    if (roleError) {
      redirect('/super-admin/users?error=role_failed');
    }
  }

  // Deliberately the ordinary cookie-based client, not serviceClient — a
  // service_role JWT has no auth.uid(), so log_audit_event would record a
  // null actor if called through it. The inviting super_admin's own
  // session must be used to capture who actually did this.
  const auditClient = await createServerSupabaseClient();
  await logAuditEvent(auditClient, {
    action: 'user_created',
    entityType: 'profile',
    entityId: invited.user.id,
    newState: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      userCode: parsed.data.userCode,
      role: parsed.data.role,
    },
  });

  redirect('/super-admin/users?invited=1');
}
```

- [ ] **Step 5: Build check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors or warnings.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/admin/leave/actions.ts" "src/app/(app)/super-admin/service-holidays/actions.ts" "src/app/(app)/admin/concerns/[id]/actions.ts" "src/app/(app)/super-admin/users/actions.ts"
git commit -m "feat: audit-log leave, service-holiday, concern-status, and user-invite actions"
```

---

### Task 5: `updateUserAction` multi-aspect audit logic

**Files:**
- Create: `src/lib/audit/user-change-events.ts`
- Create: `src/lib/audit/user-change-events.test.ts`
- Modify: `src/app/(app)/super-admin/users/[id]/actions.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks except the `AuditEventParams` shape (Task 2), which this task's output matches structurally without importing it (kept as inline object literals to avoid a needless cross-import — same shape, no behavior difference).
- Produces: `computeUserAuditEvents(targetId: string, previous: ProfileSnapshot, next: ProfileSnapshot): AuditEvent[]`, consumed by `updateUserAction` in this same task.

A single form submission can change a user's name/mobile/email, active status, and role all at once. The spec lists these as three distinct audit event types (`user_edited`, `user_activated`/`user_deactivated`, `role_changed`), so this comparison is real branching logic — pulled into a small pure function so it's unit-testable without a live database, rather than folded directly into the Server Action (which needs a real request context to run at all).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/audit/user-change-events.test.ts
import { describe, it, expect } from 'vitest';
import { computeUserAuditEvents } from './user-change-events';

const base = {
  fullName: 'Asha Mehta',
  mobile: '9990001111',
  email: 'asha@example.com',
  role: 'user' as const,
  active: true,
};

describe('computeUserAuditEvents', () => {
  it('emits nothing when nothing changed', () => {
    expect(computeUserAuditEvents('u1', base, { ...base })).toEqual([]);
  });

  it('emits a user_edited event when contact info changes', () => {
    const events = computeUserAuditEvents('u1', base, { ...base, mobile: '9990002222' });
    expect(events).toEqual([
      {
        action: 'user_edited',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { fullName: base.fullName, mobile: base.mobile, email: base.email },
        newState: { fullName: base.fullName, mobile: '9990002222', email: base.email },
      },
    ]);
  });

  it('emits user_deactivated when active flips to false', () => {
    const events = computeUserAuditEvents('u1', base, { ...base, active: false });
    expect(events).toEqual([
      {
        action: 'user_deactivated',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { active: true },
        newState: { active: false },
      },
    ]);
  });

  it('emits user_activated when active flips to true', () => {
    const inactive = { ...base, active: false };
    const events = computeUserAuditEvents('u1', inactive, { ...inactive, active: true });
    expect(events).toEqual([
      {
        action: 'user_activated',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { active: false },
        newState: { active: true },
      },
    ]);
  });

  it('emits role_changed when role changes', () => {
    const events = computeUserAuditEvents('u1', base, { ...base, role: 'admin' });
    expect(events).toEqual([
      {
        action: 'role_changed',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { role: 'user' },
        newState: { role: 'admin' },
      },
    ]);
  });

  it('emits three events, one per changed aspect, when everything changes at once', () => {
    const events = computeUserAuditEvents('u1', base, {
      fullName: 'Asha M.',
      mobile: base.mobile,
      email: base.email,
      role: 'admin',
      active: false,
    });
    expect(events.map((e) => e.action)).toEqual(['user_edited', 'user_deactivated', 'role_changed']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/audit/user-change-events.test.ts`
Expected: FAIL — `Cannot find module './user-change-events'`

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/audit/user-change-events.ts
export type ProfileSnapshot = {
  fullName: string;
  mobile: string | null;
  email: string;
  role: 'user' | 'admin' | 'super_admin';
  active: boolean;
};

export type UserAuditEvent = {
  action: 'user_edited' | 'user_activated' | 'user_deactivated' | 'role_changed';
  entityType: 'profile';
  entityId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
};

export function computeUserAuditEvents(
  targetId: string,
  previous: ProfileSnapshot,
  next: ProfileSnapshot
): UserAuditEvent[] {
  const events: UserAuditEvent[] = [];

  if (
    previous.fullName !== next.fullName ||
    previous.mobile !== next.mobile ||
    previous.email !== next.email
  ) {
    events.push({
      action: 'user_edited',
      entityType: 'profile',
      entityId: targetId,
      previousState: { fullName: previous.fullName, mobile: previous.mobile, email: previous.email },
      newState: { fullName: next.fullName, mobile: next.mobile, email: next.email },
    });
  }

  if (previous.active !== next.active) {
    events.push({
      action: next.active ? 'user_activated' : 'user_deactivated',
      entityType: 'profile',
      entityId: targetId,
      previousState: { active: previous.active },
      newState: { active: next.active },
    });
  }

  if (previous.role !== next.role) {
    events.push({
      action: 'role_changed',
      entityType: 'profile',
      entityId: targetId,
      previousState: { role: previous.role },
      newState: { role: next.role },
    });
  }

  return events;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/audit/user-change-events.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Wire it into `updateUserAction`**

In `src/app/(app)/super-admin/users/[id]/actions.ts`, add the imports:

```ts
import { logAuditEvent } from '@/lib/audit';
import { computeUserAuditEvents } from '@/lib/audit/user-change-events';
```

Change `updateUserAction` from:

```ts
export async function updateUserAction(formData: FormData) {
  const profile = await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const targetId = formData.get('userId') as string;

  const parsed = updateUserSchema.safeParse({
    fullName: formData.get('fullName'),
    mobile: formData.get('mobile'),
    email: formData.get('email'),
    role: formData.get('role'),
    active: formData.get('active'),
  });

  if (!parsed.success) {
    redirect(`/super-admin/users/${targetId}?error=invalid`);
  }

  // Contact-info edits on a super_admin's own row are fine — only a role or
  // active-status CHANGE on their own row is rejected. The edit page's own
  // UI never lets a self-viewer submit a changed role/active value (see
  // Task 4 Step 2), so this only fires if that's somehow bypassed.
  if (targetId === profile.id) {
    const { data: current } = await supabase
      .from('profiles')
      .select('role, active')
      .eq('id', targetId)
      .maybeSingle();
    if (current && (current.role !== parsed.data.role || current.active !== parsed.data.active)) {
      redirect(`/super-admin/users/${targetId}?error=self_lock`);
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      email: parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    })
    .eq('id', targetId);

  if (error) {
    redirect(`/super-admin/users/${targetId}?error=save_failed`);
  }

  redirect(`/super-admin/users/${targetId}?saved=1`);
}
```

to:

```ts
export async function updateUserAction(formData: FormData) {
  const profile = await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const targetId = formData.get('userId') as string;

  const parsed = updateUserSchema.safeParse({
    fullName: formData.get('fullName'),
    mobile: formData.get('mobile'),
    email: formData.get('email'),
    role: formData.get('role'),
    active: formData.get('active'),
  });

  if (!parsed.success) {
    redirect(`/super-admin/users/${targetId}?error=invalid`);
  }

  // Fetched unconditionally now (not just for the self-target case): the
  // audit trail needs the previous state for every edit, and this same
  // fetch also feeds the self-lock check below.
  const { data: current, error: currentError } = await supabase
    .from('profiles')
    .select('full_name, mobile, email, role, active')
    .eq('id', targetId)
    .maybeSingle();

  if (currentError || !current) {
    redirect(`/super-admin/users/${targetId}?error=save_failed`);
  }

  // Contact-info edits on a super_admin's own row are fine — only a role or
  // active-status CHANGE on their own row is rejected. The edit page's own
  // UI never lets a self-viewer submit a changed role/active value (see
  // Task 4 Step 2), so this only fires if that's somehow bypassed.
  if (targetId === profile.id && (current!.role !== parsed.data.role || current!.active !== parsed.data.active)) {
    redirect(`/super-admin/users/${targetId}?error=self_lock`);
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      email: parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    })
    .eq('id', targetId);

  if (error) {
    redirect(`/super-admin/users/${targetId}?error=save_failed`);
  }

  const events = computeUserAuditEvents(
    targetId,
    {
      fullName: current!.full_name,
      mobile: current!.mobile,
      email: current!.email,
      role: current!.role,
      active: current!.active,
    },
    {
      fullName: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      email: parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    }
  );
  for (const event of events) {
    await logAuditEvent(supabase, event);
  }

  redirect(`/super-admin/users/${targetId}?saved=1`);
}
```

- [ ] **Step 6: Build check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors or warnings. (Behavioral verification of this wiring against a real database happens live in Task 6/7's verification, since `updateUserAction` itself cannot run outside a real Next.js request context — the pure decision logic is what Step 1-4 already proved correct.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/audit/user-change-events.ts src/lib/audit/user-change-events.test.ts "src/app/(app)/super-admin/users/[id]/actions.ts"
git commit -m "feat: audit-log user edits, activation, and role changes"
```

---

### Task 6: `/super-admin/audit` viewer page + nav link

**Files:**
- Create: `src/app/(app)/super-admin/audit/page.tsx`
- Modify: `src/app/(app)/super-admin/page.tsx`

**Interfaces:**
- Consumes: `audit_logs` table (Task 1), `requireRole` (`@/lib/auth`), `createServerSupabaseClient` (`@/lib/supabase/server`).

- [ ] **Step 1: Write the viewer page**

```tsx
// src/app/(app)/super-admin/audit/page.tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const ENTITY_TYPES = ['menu_version', 'profile', 'user_leave', 'service_holiday', 'concern'];
const ACTIONS = [
  'menu_created',
  'menu_edited',
  'menu_submitted',
  'menu_approved',
  'menu_rejected',
  'user_created',
  'user_edited',
  'user_activated',
  'user_deactivated',
  'role_changed',
  'leave_created',
  'service_holiday_created',
  'concern_status_changed',
];

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entityType?: string; action?: string; from?: string; to?: string }>;
}) {
  await requireRole(['super_admin']);
  const { entityType, action, from: fromParam, to: toParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const from = fromParam && /^\d{4}-\d{2}-\d{2}$/.test(fromParam) ? fromParam : null;
  const to = toParam && /^\d{4}-\d{2}-\d{2}$/.test(toParam) ? toParam : null;
  const hasFilter = Boolean(entityType || action || from || to);

  const errorState = (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/super-admin" className="text-lg text-blue-600 underline">
        ← Back to Super Admin
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Audit Log</h1>
      <p className="mt-6 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
        Could not load the audit log. Please try again.
      </p>
    </main>
  );

  let query = supabase
    .from('audit_logs')
    .select('id, actor_id, action, entity_type, entity_id, previous_state, new_state, created_at')
    .order('created_at', { ascending: false });

  if (entityType) query = query.eq('entity_type', entityType);
  if (action) query = query.eq('action', action);
  if (from) query = query.gte('created_at', `${from}T00:00:00`);
  if (to) query = query.lte('created_at', `${to}T23:59:59`);
  if (!hasFilter) query = query.limit(200);

  const { data: logRows, error } = await query;
  if (error) return errorState;

  const actorIds = Array.from(new Set((logRows ?? []).map((r) => r.actor_id).filter((id): id is string => Boolean(id))));
  const { data: actors, error: actorsError } =
    actorIds.length > 0
      ? await supabase.from('profiles').select('id, full_name, user_code').in('id', actorIds)
      : { data: [] as { id: string; full_name: string; user_code: string }[], error: null };
  if (actorsError) return errorState;

  const actorMap = new Map((actors ?? []).map((a) => [a.id, a]));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <Link href="/super-admin" className="text-lg text-blue-600 underline">
        ← Back to Super Admin
      </Link>
      <h1 className="mt-4 text-3xl font-bold">Audit Log</h1>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 p-4">
        <div>
          <label className="text-sm font-semibold" htmlFor="entityType">
            Entity type
          </label>
          <select
            id="entityType"
            name="entityType"
            defaultValue={entityType ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="">All</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="action">
            Action
          </label>
          <select
            id="action"
            name="action"
            defaultValue={action ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          >
            <option value="">All</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="from">
            From
          </label>
          <input
            id="from"
            name="from"
            type="date"
            defaultValue={from ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="to">
            To
          </label>
          <input
            id="to"
            name="to"
            type="date"
            defaultValue={to ?? ''}
            className="mt-1 h-12 w-full rounded-lg border border-gray-300 px-3 text-lg"
          />
        </div>
        <button type="submit" className="h-12 rounded-lg bg-blue-600 px-6 text-lg font-semibold text-white">
          Filter
        </button>
      </form>

      {!logRows || logRows.length === 0 ? (
        <p className="mt-6 text-lg text-gray-600">No matching audit records for this filter.</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-300 text-sm font-semibold">
                <th className="py-2 pr-4">Time</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody className="text-lg">
              {logRows.map((row) => {
                const actor = row.actor_id ? actorMap.get(row.actor_id) : undefined;
                return (
                  <tr key={row.id} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-4 whitespace-nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-4">
                      {actor ? `${actor.full_name} (${actor.user_code})` : (row.actor_id ?? '—')}
                    </td>
                    <td className="py-2 pr-4">{row.action}</td>
                    <td className="py-2 pr-4">
                      {row.entity_type} / {row.entity_id}
                    </td>
                    <td className="py-2">
                      <details>
                        <summary className="cursor-pointer text-blue-600">view</summary>
                        <pre className="mt-2 max-w-md overflow-x-auto rounded bg-gray-50 p-2 text-sm">
{JSON.stringify({ previous: row.previous_state ?? null, new: row.new_state ?? null }, null, 2)}
                        </pre>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Add the nav link**

In `src/app/(app)/super-admin/page.tsx`, change:

```tsx
        <Link
          href="/super-admin/users"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          Manage Users
        </Link>
      </div>
```

to:

```tsx
        <Link
          href="/super-admin/users"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          Manage Users
        </Link>
        <Link
          href="/super-admin/audit"
          className="inline-block rounded-lg bg-blue-600 px-4 py-3 text-lg text-white"
        >
          Audit Log
        </Link>
      </div>
```

- [ ] **Step 3: Build check**

Run: `npx tsc --noEmit && npm run lint`
Expected: no new errors or warnings.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/super-admin/audit/page.tsx" "src/app/(app)/super-admin/page.tsx"
git commit -m "feat: add /super-admin/audit viewer page and nav link"
```

---

### Task 7: Integration tests for `log_audit_event` RLS/RPC behavior

**Files:**
- Create: `src/lib/supabase/audit-log-rls.integration.test.ts`

**Interfaces:**
- Consumes: `public.log_audit_event` RPC (Task 1), seeded users `admin1@fmb.test` (admin), `superadmin@fmb.test` (super_admin), `user1@fmb.test` (user), all password `DevPass123!` (from `scripts/seed-users.ts`), and `US001` as a seeded `user_code` to look up a real target profile id.

- [ ] **Step 1: Write the tests**

```ts
// src/lib/supabase/audit-log-rls.integration.test.ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('log_audit_event RPC and audit_logs RLS', () => {
  it('an admin calling log_audit_event gets a row with their own actor_id, regardless of the entity referenced', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: target } = await serviceClient.from('profiles').select('id').eq('user_code', 'US001').single();

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });
    const adminId = (await adminClient.auth.getUser()).data.user!.id;

    const { error: rpcError } = await adminClient.rpc('log_audit_event', {
      p_action: 'user_edited',
      p_entity_type: 'profile',
      p_entity_id: target!.id,
      p_previous_state: { fullName: 'Old Name' },
      p_new_state: { fullName: 'New Name' },
      p_ip_address: null,
    });
    expect(rpcError).toBeNull();

    const superAdminClient = createClient(url!, anonKey!);
    await superAdminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });
    const { data: rows } = await superAdminClient
      .from('audit_logs')
      .select('actor_id, entity_id')
      .eq('entity_id', target!.id)
      .eq('action', 'user_edited')
      .order('created_at', { ascending: false })
      .limit(1);
    expect(rows).toHaveLength(1);
    expect(rows![0].actor_id).toBe(adminId);
  });

  it('an ordinary user cannot call log_audit_event', async () => {
    const userClient = createClient(url!, anonKey!);
    await userClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const { error } = await userClient.rpc('log_audit_event', {
      p_action: 'user_edited',
      p_entity_type: 'profile',
      p_entity_id: 'irrelevant',
      p_previous_state: null,
      p_new_state: null,
      p_ip_address: null,
    });
    expect(error).not.toBeNull();
  });

  it('an admin can write an audit row via the RPC but cannot read audit_logs directly; a super_admin can read', async () => {
    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { error: rpcError } = await adminClient.rpc('log_audit_event', {
      p_action: 'leave_created',
      p_entity_type: 'user_leave',
      p_entity_id: 'read-asymmetry-test',
      p_previous_state: null,
      p_new_state: { note: 'read asymmetry test' },
      p_ip_address: null,
    });
    expect(rpcError).toBeNull();

    const { data: adminReadRows } = await adminClient
      .from('audit_logs')
      .select('id')
      .eq('entity_id', 'read-asymmetry-test');
    expect(adminReadRows).toHaveLength(0);

    const superAdminClient = createClient(url!, anonKey!);
    await superAdminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });
    const { data: superAdminReadRows } = await superAdminClient
      .from('audit_logs')
      .select('id')
      .eq('entity_id', 'read-asymmetry-test');
    expect(superAdminReadRows).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/lib/supabase/audit-log-rls.integration.test.ts`
Expected: PASS, 3 tests. (Requires a running local Supabase instance with seeded users — same precondition as every other `*.integration.test.ts` file in this project; the `skip` guard means these silently no-op if `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` aren't set.)

- [ ] **Step 3: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass, including the new ones from this task and Task 5.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/audit-log-rls.integration.test.ts
git commit -m "test: add integration coverage for log_audit_event RPC and audit_logs RLS"
```

---

## Manual verification (after all tasks)

Once all 7 tasks are committed, do one live pass through the running dev app as a `super_admin`:
1. Create a menu, edit it, submit it for approval, approve it as a different super_admin session — confirm 5 rows appear in `/super-admin/audit` (`menu_created`, `menu_edited`, `menu_submitted`, and the pre-existing `menu_approved`).
2. Invite a new user, then edit that user's name and role in one submit — confirm `user_created` appears, then confirm exactly two rows appear for the edit (`user_edited` and `role_changed`), not one merged row.
3. Add a leave entry and a service holiday — confirm `leave_created` and `service_holiday_created` appear.
4. Reply to a concern with a status change — confirm `concern_status_changed` appears with the correct before/after status.
5. Filter the audit page by `entityType=profile` and confirm only the user-related rows show; filter by a date range that excludes everything and confirm the "No matching audit records for this filter." empty state renders.
6. Sign in as a plain `admin` (not `super_admin`) and confirm `/super-admin/audit` is unreachable (redirected/blocked by `requireRole`).
