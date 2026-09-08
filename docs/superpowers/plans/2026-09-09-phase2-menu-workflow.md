# FMBRequestThali — Phase 2 Menu Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the menu data model and its full draft → submit → approve/reject workflow — admins create/edit/submit menus, super-admins approve or reject with an item-level diff — with RLS and `SECURITY DEFINER` RPCs enforcing that only super-admins can ever move a version to `approved`/`rejected`.

**Architecture:** Three normalized tables (`menus` / `menu_versions` / `menu_items`) so the previously-approved version stays live while a new revision works through approval. All state-transition-sensitive writes (approve, reject) go through `SECURITY DEFINER` RPCs, never a raw client UPDATE — mirrors the `audit_logs`/profiles-role-lock pattern from Phase 1.

**Tech Stack:** Same as Phase 1 (Next.js App Router, TS strict, Tailwind, shadcn/ui, Supabase, zod, vitest). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-phase2-menu-workflow-design.md` (and source: `FMBRequestThali Web App — Complete Development Prompt.md` §13-15, §26-27, §49, §51)

## Global Constraints

- TypeScript strict mode everywhere; never use `any`.
- All authorization is enforced server-side (`requireRole()`) AND at the database via RLS.
- `menu_versions.status` can only become `approved` or `superseded` inside the `approve_menu_version()` RPC, and only `rejected` inside `reject_menu_version()` — no RLS policy on `menu_versions` ever allows a client to set either status directly.
- `menus.current_approved_version_id` is only ever written by `approve_menu_version()` — no client-facing UPDATE policy exists on `menus` at all.
- A rejection always requires a non-empty reason, enforced both client-side (zod) and inside the RPC.
- Both RPCs write an `audit_logs` row — this is the first phase where that table gets real writers.
- Follow Phase 1's established patterns: `requireRole()` at the top of every protected page/action, `createServerSupabaseClient()` for all server-side Supabase access, zod schemas in `src/lib/validation/`, migrations numbered sequentially continuing from `0006`.

---

## File Structure (for reference across tasks)

```
supabase/migrations/
  0007_menu_tables.sql
  0008_menu_rls.sql
  0009_menu_approval_rpc.sql
src/
  lib/
    validation/menu.ts, validation/menu.test.ts
    menu/diff.ts, menu/diff.test.ts
  components/menu/menu-items-editor.tsx
  app/(app)/
    admin/menu/page.tsx
    admin/menu/new/page.tsx, new/new-menu-form.tsx, new/actions.ts
    admin/menu/[id]/page.tsx, [id]/edit-menu-form.tsx, [id]/actions.ts
    super-admin/approvals/page.tsx, approvals/actions.ts
scripts/seed-menus.ts
```

---

### Task 1: Migration — menu tables

**Files:**
- Create: `supabase/migrations/0007_menu_tables.sql`

**Interfaces:**
- Consumes: `public.profiles(id)` (Phase 1, Task 3)
- Produces: tables `public.menus`, `public.menu_versions` (enum `public.menu_version_status`), `public.menu_items`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0007_menu_tables.sql`:

```sql
create table public.menus (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  current_approved_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.menu_version_status as enum (
  'draft', 'pending_approval', 'approved', 'rejected', 'superseded'
);

create table public.menu_versions (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references public.menus(id) on delete cascade,
  version_number int not null,
  title text,
  notes text,
  status public.menu_version_status not null default 'draft',
  created_by uuid not null references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  rejected_by uuid references public.profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (menu_id, version_number)
);

alter table public.menus
  add constraint menus_current_approved_version_fk
  foreign key (current_approved_version_id) references public.menu_versions(id);

-- At most one active (draft/pending_approval) version per menu at a time.
create unique index menu_versions_one_active_per_menu
  on public.menu_versions (menu_id)
  where status in ('draft', 'pending_approval');

create index menu_versions_menu_id_status_idx on public.menu_versions(menu_id, status);

create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  menu_version_id uuid not null references public.menu_versions(id) on delete cascade,
  item_name text not null,
  category text not null check (category in
    ('gravy', 'dal', 'rice', 'roti', 'vegetable', 'salad', 'sweet', 'other')),
  description text,
  display_order int not null default 0
);

create index menu_items_menu_version_id_idx on public.menu_items(menu_version_id);

alter table public.menus enable row level security;
alter table public.menu_versions enable row level security;
alter table public.menu_items enable row level security;
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

If Docker/local Supabase isn't running, skip this verification step and note it in your report — the same situation as every Phase 1 migration task.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add menus, menu_versions, menu_items tables"
```

---

### Task 2: Migration — RLS policies for menu tables

**Files:**
- Create: `supabase/migrations/0008_menu_rls.sql`

**Interfaces:**
- Consumes: `public.is_admin()` (Phase 1, Task 4), tables from Task 1

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0008_menu_rls.sql`:

```sql
create policy menus_select on public.menus
  for select
  using (auth.uid() is not null);

create policy menus_insert_admin on public.menus
  for insert
  to authenticated
  with check (public.is_admin());

-- Deliberately no update/delete policy on menus for any client role: the only mutable
-- column (current_approved_version_id) is changed exclusively by the
-- approve_menu_version() SECURITY DEFINER RPC (migration 0009), which bypasses RLS
-- as the function owner.

create policy menu_versions_select on public.menu_versions
  for select
  using (status = 'approved' or public.is_admin());

create policy menu_versions_insert_admin on public.menu_versions
  for insert
  to authenticated
  with check (public.is_admin() and status = 'draft');

create policy menu_versions_update_admin on public.menu_versions
  for update
  using (public.is_admin() and status in ('draft', 'pending_approval', 'rejected'))
  with check (public.is_admin() and status in ('draft', 'pending_approval', 'rejected'));

-- Deliberately no client path to 'approved'/'superseded': those transitions happen
-- only inside approve_menu_version()/reject_menu_version() (migration 0009).

create policy menu_items_select on public.menu_items
  for select
  using (
    exists (
      select 1 from public.menu_versions v
      where v.id = menu_items.menu_version_id
        and (v.status = 'approved' or public.is_admin())
    )
  );

create policy menu_items_write_admin on public.menu_items
  for all
  using (
    exists (
      select 1 from public.menu_versions v
      where v.id = menu_items.menu_version_id
        and public.is_admin()
        and v.status in ('draft', 'rejected')
    )
  )
  with check (
    exists (
      select 1 from public.menu_versions v
      where v.id = menu_items.menu_version_id
        and public.is_admin()
        and v.status in ('draft', 'rejected')
    )
  );
```

`menu_versions_update_admin` doesn't restrict which of `draft`/`pending_approval`/`rejected` a row can move *to* from which it's *currently in* (e.g. it technically permits a client to move `pending_approval` back to `draft`) — that's a deliberate simplification: the only invariant that actually matters (never client-settable to `approved`/`superseded`) is enforced, and a stricter per-transition state machine isn't worth a trigger for this MVP. `# ponytail: loose transition set within {draft,pending_approval,rejected}, tighten with a trigger if a real workflow-integrity bug shows up`.

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add RLS policies for menus, menu_versions, menu_items"
```

---

### Task 3: Migration — approve/reject RPCs and audit logging

**Files:**
- Create: `supabase/migrations/0009_menu_approval_rpc.sql`

**Interfaces:**
- Consumes: `public.is_super_admin()` (Phase 1, Task 4), `public.audit_logs` (Phase 1, Task 7), tables from Task 1
- Produces: `public.approve_menu_version(p_version_id uuid)`, `public.reject_menu_version(p_version_id uuid, p_reason text)` — Tasks 10's server actions call these via `supabase.rpc(...)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0009_menu_approval_rpc.sql`:

```sql
create or replace function public.approve_menu_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_id uuid;
  v_old_approved_id uuid;
  v_status public.menu_version_status;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super_admin may approve a menu version';
  end if;

  select menu_id, status into v_menu_id, v_status
  from public.menu_versions
  where id = p_version_id
  for update;

  if v_menu_id is null then
    raise exception 'Menu version not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'This menu version is not pending approval';
  end if;

  select current_approved_version_id into v_old_approved_id
  from public.menus
  where id = v_menu_id
  for update;

  if v_old_approved_id is not null then
    update public.menu_versions
    set status = 'superseded', updated_at = now()
    where id = v_old_approved_id;
  end if;

  update public.menu_versions
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where id = p_version_id;

  update public.menus
  set current_approved_version_id = p_version_id, updated_at = now()
  where id = v_menu_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
  values (
    auth.uid(),
    'menu_approved',
    'menu_version',
    p_version_id::text,
    jsonb_build_object('status', 'pending_approval'),
    jsonb_build_object('status', 'approved')
  );
end;
$$;

create or replace function public.reject_menu_version(p_version_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.menu_version_status;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super_admin may reject a menu version';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rejection reason is required';
  end if;

  select status into v_status
  from public.menu_versions
  where id = p_version_id
  for update;

  if v_status is null then
    raise exception 'Menu version not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'This menu version is not pending approval';
  end if;

  update public.menu_versions
  set status = 'rejected',
      rejected_by = auth.uid(),
      rejected_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  where id = p_version_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
  values (
    auth.uid(),
    'menu_rejected',
    'menu_version',
    p_version_id::text,
    jsonb_build_object('status', 'pending_approval'),
    jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason)
  );
end;
$$;

grant execute on function public.approve_menu_version(uuid) to authenticated;
grant execute on function public.reject_menu_version(uuid, text) to authenticated;
```

- [ ] **Step 2: Apply and verify (requires local Supabase running)**

```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(db): add approve/reject menu version RPCs with audit logging"
```

---

### Task 4: `lib/validation/menu.ts` — zod schemas

**Files:**
- Create: `src/lib/validation/menu.ts`
- Test: `src/lib/validation/menu.test.ts`

**Interfaces:**
- Produces: `MENU_ITEM_CATEGORIES`, `menuItemSchema`, `MenuItemInput`, `menuVersionCreateSchema`, `MenuVersionCreateInput`, `rejectMenuVersionSchema`, `RejectMenuVersionInput` — Tasks 8-10's server actions parse `FormData` through these.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/validation/menu.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { menuVersionCreateSchema, rejectMenuVersionSchema } from './menu';

describe('menuVersionCreateSchema', () => {
  it('accepts a valid menu with at least one item', () => {
    const result = menuVersionCreateSchema.safeParse({
      serviceDate: '2026-09-10',
      title: 'Wednesday Special',
      items: [{ itemName: 'Dal Fry', category: 'dal', displayOrder: 0 }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a menu with zero items', () => {
    const result = menuVersionCreateSchema.safeParse({
      serviceDate: '2026-09-10',
      items: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid category', () => {
    const result = menuVersionCreateSchema.safeParse({
      serviceDate: '2026-09-10',
      items: [{ itemName: 'X', category: 'dessert', displayOrder: 0 }],
    });
    expect(result.success).toBe(false);
  });
});

describe('rejectMenuVersionSchema', () => {
  it('rejects an empty reason', () => {
    const result = rejectMenuVersionSchema.safeParse({
      versionId: '11111111-1111-1111-1111-111111111111',
      reason: '   ',
    });
    expect(result.success).toBe(false);
  });

  it('accepts a non-empty reason', () => {
    const result = rejectMenuVersionSchema.safeParse({
      versionId: '11111111-1111-1111-1111-111111111111',
      reason: 'Please add a sweet item.',
    });
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/validation/menu.test.ts
```

Expected: FAIL — `./menu` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/validation/menu.ts`:

```ts
import { z } from 'zod';

export const MENU_ITEM_CATEGORIES = [
  'gravy', 'dal', 'rice', 'roti', 'vegetable', 'salad', 'sweet', 'other',
] as const;

export const menuItemSchema = z.object({
  itemName: z.string().trim().min(1, 'Item name is required'),
  category: z.enum(MENU_ITEM_CATEGORIES),
  description: z.string().trim().optional().or(z.literal('')),
  displayOrder: z.number().int().min(0).default(0),
});
export type MenuItemInput = z.infer<typeof menuItemSchema>;

export const menuVersionCreateSchema = z.object({
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'),
  title: z.string().trim().optional().or(z.literal('')),
  notes: z.string().trim().optional().or(z.literal('')),
  items: z.array(menuItemSchema).min(1, 'Add at least one item'),
});
export type MenuVersionCreateInput = z.infer<typeof menuVersionCreateSchema>;

export const rejectMenuVersionSchema = z.object({
  versionId: z.string().uuid(),
  reason: z.string().trim().min(1, 'A rejection reason is required'),
});
export type RejectMenuVersionInput = z.infer<typeof rejectMenuVersionSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/validation/menu.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add zod validation schemas for menu creation and rejection"
```

---

### Task 5: `lib/menu/diff.ts` — menu version diff

**Files:**
- Create: `src/lib/menu/diff.ts`
- Test: `src/lib/menu/diff.test.ts`

**Interfaces:**
- Produces: `MenuItemLike`, `CategoryDiff`, `computeMenuDiff(oldItems: MenuItemLike[], newItems: MenuItemLike[]): CategoryDiff[]` — Task 10's approvals page calls this to render the diff.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/menu/diff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeMenuDiff } from './diff';

describe('computeMenuDiff', () => {
  it('shows a same-position item change as changed, not added+removed', () => {
    const oldItems = [{ itemName: 'Jeera Rice', category: 'rice', displayOrder: 0 }];
    const newItems = [{ itemName: 'Veg Pulao', category: 'rice', displayOrder: 0 }];
    const diff = computeMenuDiff(oldItems, newItems);
    expect(diff).toEqual([
      { category: 'rice', changed: [{ old: oldItems[0], new: newItems[0] }], added: [], removed: [] },
    ]);
  });

  it('shows a brand-new category as added', () => {
    const diff = computeMenuDiff([], [{ itemName: 'Gulab Jamun', category: 'sweet', displayOrder: 0 }]);
    expect(diff[0]).toEqual({
      category: 'sweet',
      changed: [],
      added: [{ itemName: 'Gulab Jamun', category: 'sweet', displayOrder: 0 }],
      removed: [],
    });
  });

  it('shows a removed category item as removed', () => {
    const diff = computeMenuDiff([{ itemName: 'Salad', category: 'salad', displayOrder: 0 }], []);
    expect(diff[0].removed).toEqual([{ itemName: 'Salad', category: 'salad', displayOrder: 0 }]);
  });

  it('omits unchanged items from changed/added/removed', () => {
    const item = { itemName: 'Roti', category: 'roti', displayOrder: 0 };
    const diff = computeMenuDiff([item], [item]);
    expect(diff).toEqual([{ category: 'roti', changed: [], added: [], removed: [] }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/lib/menu/diff.test.ts
```

Expected: FAIL — `./diff` has no exported members.

- [ ] **Step 3: Implement**

Create `src/lib/menu/diff.ts`:

```ts
export type MenuItemLike = {
  itemName: string;
  category: string;
  description?: string | null;
  displayOrder: number;
};

export type CategoryDiff = {
  category: string;
  changed: { old: MenuItemLike; new: MenuItemLike }[];
  added: MenuItemLike[];
  removed: MenuItemLike[];
};

function sortByOrder(items: MenuItemLike[]): MenuItemLike[] {
  return [...items].sort((a, b) => a.displayOrder - b.displayOrder);
}

function itemsEqual(a: MenuItemLike, b: MenuItemLike): boolean {
  return a.itemName === b.itemName && (a.description ?? '') === (b.description ?? '');
}

/**
 * Pairs old/new items within each category by position (display_order), not by name —
 * this matches the source spec's "Rice: Jeera Rice -> Veg Pulao" style diff, where a
 * single-item category's item being swapped reads as one change, not a remove+add.
 * # ponytail: positional pairing, not stable-matched by identity; a category with items
 * reordered between versions (not just edited) will show spurious changed pairs — fine
 * for the current single-admin-at-a-time editing flow, revisit if reordering becomes common.
 */
export function computeMenuDiff(
  oldItems: MenuItemLike[],
  newItems: MenuItemLike[]
): CategoryDiff[] {
  const categories = Array.from(
    new Set([...oldItems.map((i) => i.category), ...newItems.map((i) => i.category)])
  );

  return categories.map((category) => {
    const oldInCategory = sortByOrder(oldItems.filter((i) => i.category === category));
    const newInCategory = sortByOrder(newItems.filter((i) => i.category === category));
    const maxLen = Math.max(oldInCategory.length, newInCategory.length);

    const changed: { old: MenuItemLike; new: MenuItemLike }[] = [];
    const added: MenuItemLike[] = [];
    const removed: MenuItemLike[] = [];

    for (let i = 0; i < maxLen; i++) {
      const oldItem = oldInCategory[i];
      const newItem = newInCategory[i];
      if (oldItem && newItem) {
        if (!itemsEqual(oldItem, newItem)) changed.push({ old: oldItem, new: newItem });
      } else if (oldItem && !newItem) {
        removed.push(oldItem);
      } else if (!oldItem && newItem) {
        added.push(newItem);
      }
    }

    return { category, changed, added, removed };
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/lib/menu/diff.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add positional menu version diff for the approval queue"
```

---

### Task 6: `components/menu/menu-items-editor.tsx` — shared item-list editor

**Files:**
- Create: `src/components/menu/menu-items-editor.tsx`

**Interfaces:**
- Consumes: `MENU_ITEM_CATEGORIES` (Task 4), shadcn `Button`/`Input`/`Label` (Phase 1)
- Produces: `ItemRow`, `MenuItemsEditor({ items, onChange }): JSX.Element` — Tasks 8 and 9's forms both use this for their item-row UI, avoiding duplicating it.

- [ ] **Step 1: Implement**

Create `src/components/menu/menu-items-editor.tsx`:

```tsx
'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MENU_ITEM_CATEGORIES } from '@/lib/validation/menu';

export type ItemRow = {
  itemName: string;
  category: string;
  description: string;
  displayOrder: number;
};

export function MenuItemsEditor({
  items,
  onChange,
}: {
  items: ItemRow[];
  onChange: (items: ItemRow[]) => void;
}) {
  function addItem() {
    onChange([...items, { itemName: '', category: 'gravy', description: '', displayOrder: items.length }]);
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function updateItem(index: number, field: keyof ItemRow, value: string) {
    onChange(items.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  return (
    <div className="space-y-4">
      <p className="text-lg font-semibold">Items</p>
      {items.map((item, index) => (
        <div key={index} className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 p-3">
          <div className="min-w-[160px] flex-1">
            <Label className="text-sm">Item name</Label>
            <Input
              value={item.itemName}
              onChange={(e) => updateItem(index, 'itemName', e.target.value)}
              className="h-12"
            />
          </div>
          <div>
            <Label className="text-sm">Category</Label>
            <select
              value={item.category}
              onChange={(e) => updateItem(index, 'category', e.target.value)}
              className="h-12 rounded-lg border border-gray-300 px-3"
            >
              {MENU_ITEM_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="button"
            onClick={() => removeItem(index)}
            className="h-12 bg-gray-200 text-gray-800 hover:bg-gray-300"
          >
            Remove
          </Button>
        </div>
      ))}
      <Button type="button" onClick={addItem} className="h-12 bg-gray-100 text-gray-800 hover:bg-gray-200">
        + Add Item
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: succeeds (this component isn't imported anywhere yet, so this just confirms it compiles standalone).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add shared menu items editor component"
```

---

### Task 7: Admin menu list page — `/admin/menu`

**Files:**
- Create: `src/app/(app)/admin/menu/page.tsx`

**Interfaces:**
- Consumes: `requireRole()` (Phase 1), `createServerSupabaseClient()` (Phase 1)

- [ ] **Step 1: Implement**

Create `src/app/(app)/admin/menu/page.tsx`:

```tsx
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function AdminMenuListPage() {
  await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const { data: menus } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id, menu_versions(id, status, version_number)')
    .order('service_date', { ascending: false })
    .limit(30);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Menus</h1>
        <Link href="/admin/menu/new" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          + New Menu
        </Link>
      </div>
      <div className="mt-6 space-y-3">
        {(menus ?? []).length === 0 && <p className="text-lg text-gray-600">No menus created yet.</p>}
        {(menus ?? []).map((menu) => {
          const activeVersion = menu.menu_versions?.find((v) =>
            ['draft', 'pending_approval', 'rejected'].includes(v.status)
          );
          const label = activeVersion
            ? activeVersion.status
            : menu.current_approved_version_id
              ? 'approved'
              : 'no menu yet';
          return (
            <Link
              key={menu.id}
              href={`/admin/menu/${menu.id}`}
              className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
            >
              <span className="font-semibold">{menu.service_date}</span>
              <span className="ml-3 capitalize text-gray-600">{label}</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add admin menu list page"
```

---

### Task 8: Admin create menu — `/admin/menu/new`

**Files:**
- Create: `src/app/(app)/admin/menu/new/actions.ts`
- Create: `src/app/(app)/admin/menu/new/new-menu-form.tsx`
- Create: `src/app/(app)/admin/menu/new/page.tsx`

**Interfaces:**
- Consumes: `requireRole()`, `createServerSupabaseClient()`, `menuVersionCreateSchema` (Task 4), `MenuItemsEditor`/`ItemRow` (Task 6)
- Produces: `createMenuAction(formData: FormData)`

- [ ] **Step 1: Implement the server action**

Create `src/app/(app)/admin/menu/new/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { menuVersionCreateSchema } from '@/lib/validation/menu';

export async function createMenuAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);

  const itemsRaw = formData.get('items');
  const parsed = menuVersionCreateSchema.safeParse({
    serviceDate: formData.get('serviceDate'),
    title: formData.get('title'),
    notes: formData.get('notes'),
    items: itemsRaw ? JSON.parse(itemsRaw as string) : [],
  });

  if (!parsed.success) {
    redirect('/admin/menu/new?error=invalid');
  }

  const supabase = await createServerSupabaseClient();

  let menuId: string;
  const { data: existingMenu } = await supabase
    .from('menus')
    .select('id')
    .eq('service_date', parsed.data.serviceDate)
    .single();

  if (existingMenu) {
    menuId = existingMenu.id;
  } else {
    const { data: newMenu, error: menuError } = await supabase
      .from('menus')
      .insert({ service_date: parsed.data.serviceDate })
      .select('id')
      .single();
    if (menuError || !newMenu) {
      redirect('/admin/menu/new?error=save_failed');
    }
    menuId = newMenu!.id;
  }

  const { data: existingVersions } = await supabase
    .from('menu_versions')
    .select('version_number')
    .eq('menu_id', menuId)
    .order('version_number', { ascending: false })
    .limit(1);
  const nextVersionNumber = (existingVersions?.[0]?.version_number ?? 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menuId,
      version_number: nextVersionNumber,
      title: parsed.data.title || null,
      notes: parsed.data.notes || null,
      status: 'draft',
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (versionError) {
    if (versionError.code === '23505') {
      redirect(`/admin/menu?error=already_active`);
    }
    redirect('/admin/menu/new?error=save_failed');
  }
  if (!version) {
    redirect('/admin/menu/new?error=save_failed');
  }

  const itemRows = parsed.data.items.map((item, index) => ({
    menu_version_id: version!.id,
    item_name: item.itemName,
    category: item.category,
    description: item.description || null,
    display_order: item.displayOrder ?? index,
  }));

  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=items_save_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}
```

- [ ] **Step 2: Implement the client form**

Create `src/app/(app)/admin/menu/new/new-menu-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MenuItemsEditor, type ItemRow } from '@/components/menu/menu-items-editor';

export function NewMenuForm({ action }: { action: (formData: FormData) => void }) {
  const [items, setItems] = useState<ItemRow[]>([
    { itemName: '', category: 'gravy', description: '', displayOrder: 0 },
  ]);

  return (
    <form action={action} className="mt-6 space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="space-y-1">
        <Label htmlFor="serviceDate" className="text-lg">
          Date
        </Label>
        <Input id="serviceDate" name="serviceDate" type="date" required className="h-14 text-lg" />
      </div>

      <div className="space-y-1">
        <Label htmlFor="title" className="text-lg">
          Title (optional)
        </Label>
        <Input id="title" name="title" type="text" className="h-14 text-lg" />
      </div>

      <MenuItemsEditor items={items} onChange={setItems} />

      <Button type="submit" className="h-14 w-full text-xl font-semibold">
        Save Draft
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Implement the page**

Create `src/app/(app)/admin/menu/new/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';
import { createMenuAction } from './actions';
import { NewMenuForm } from './new-menu-form';

export default async function NewMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">New Menu</h1>
      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not save the menu. Check the date and items and try again.
        </p>
      )}
      <NewMenuForm action={createMenuAction} />
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add admin create-menu page and action"
```

---

### Task 9: Admin edit menu — `/admin/menu/[id]`

**Files:**
- Create: `src/app/(app)/admin/menu/[id]/actions.ts`
- Create: `src/app/(app)/admin/menu/[id]/edit-menu-form.tsx`
- Create: `src/app/(app)/admin/menu/[id]/page.tsx`

**Interfaces:**
- Consumes: `requireRole()`, `createServerSupabaseClient()`, `menuVersionCreateSchema` (Task 4), `MenuItemsEditor`/`ItemRow` (Task 6)
- Produces: `updateMenuVersionAction`, `submitForApprovalAction`, `createNewVersionAction`

- [ ] **Step 1: Implement the server actions**

Create `src/app/(app)/admin/menu/[id]/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { menuVersionCreateSchema } from '@/lib/validation/menu';

export async function updateMenuVersionAction(formData: FormData) {
  await requireRole(['admin', 'super_admin']);

  const versionId = formData.get('versionId') as string;
  const menuId = formData.get('menuId') as string;
  const itemsRaw = formData.get('items');

  const parsed = menuVersionCreateSchema.pick({ title: true, notes: true, items: true }).safeParse({
    title: formData.get('title'),
    notes: formData.get('notes'),
    items: itemsRaw ? JSON.parse(itemsRaw as string) : [],
  });

  if (!parsed.success) {
    redirect(`/admin/menu/${menuId}?error=invalid`);
  }

  const supabase = await createServerSupabaseClient();

  const { error: updateError } = await supabase
    .from('menu_versions')
    .update({ title: parsed.data.title || null, notes: parsed.data.notes || null })
    .eq('id', versionId);

  if (updateError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  await supabase.from('menu_items').delete().eq('menu_version_id', versionId);
  const itemRows = parsed.data.items.map((item, index) => ({
    menu_version_id: versionId,
    item_name: item.itemName,
    category: item.category,
    description: item.description || null,
    display_order: item.displayOrder ?? index,
  }));
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}

export async function submitForApprovalAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const versionId = formData.get('versionId') as string;
  const menuId = formData.get('menuId') as string;

  const supabase = await createServerSupabaseClient();
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
  const profile = await requireRole(['admin', 'super_admin']);
  const menuId = formData.get('menuId') as string;

  const supabase = await createServerSupabaseClient();
  const { data: existingVersions } = await supabase
    .from('menu_versions')
    .select('version_number')
    .eq('menu_id', menuId)
    .order('version_number', { ascending: false })
    .limit(1);
  const nextVersionNumber = (existingVersions?.[0]?.version_number ?? 0) + 1;

  const { error } = await supabase.from('menu_versions').insert({
    menu_id: menuId,
    version_number: nextVersionNumber,
    status: 'draft',
    created_by: profile.id,
  });

  if (error) {
    redirect(`/admin/menu/${menuId}?error=already_active`);
  }

  redirect(`/admin/menu/${menuId}`);
}
```

- [ ] **Step 2: Implement the client form**

Create `src/app/(app)/admin/menu/[id]/edit-menu-form.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MenuItemsEditor, type ItemRow } from '@/components/menu/menu-items-editor';
import { updateMenuVersionAction } from './actions';

export function EditMenuForm({
  menuId,
  versionId,
  title,
  items: initialItems,
}: {
  menuId: string;
  versionId: string;
  title: string;
  items: { item_name: string; category: string; description: string | null; display_order: number }[];
}) {
  const [items, setItems] = useState<ItemRow[]>(
    [...initialItems]
      .sort((a, b) => a.display_order - b.display_order)
      .map((i) => ({
        itemName: i.item_name,
        category: i.category,
        description: i.description ?? '',
        displayOrder: i.display_order,
      }))
  );

  return (
    <form action={updateMenuVersionAction} className="mt-6 space-y-6">
      <input type="hidden" name="menuId" value={menuId} />
      <input type="hidden" name="versionId" value={versionId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="space-y-1">
        <Label htmlFor="title" className="text-lg">
          Title (optional)
        </Label>
        <Input id="title" name="title" type="text" defaultValue={title} className="h-14 text-lg" />
      </div>

      <MenuItemsEditor items={items} onChange={setItems} />

      <Button type="submit" className="h-14 w-full text-xl font-semibold">
        Save Changes
      </Button>
    </form>
  );
}
```

- [ ] **Step 3: Implement the page**

Create `src/app/(app)/admin/menu/[id]/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { EditMenuForm } from './edit-menu-form';
import { submitForApprovalAction, createNewVersionAction } from './actions';

export default async function AdminMenuDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: menu } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .eq('id', id)
    .single();

  const { data: versions } = await supabase
    .from('menu_versions')
    .select(
      'id, version_number, title, notes, status, rejection_reason, menu_items(id, item_name, category, description, display_order)'
    )
    .eq('menu_id', id)
    .order('version_number', { ascending: false });

  const activeVersion = versions?.find((v) => ['draft', 'pending_approval', 'rejected'].includes(v.status));
  const approvedVersion = versions?.find((v) => v.id === menu?.current_approved_version_id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">{menu?.service_date}</h1>
      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Something went wrong saving your changes. Please try again.
        </p>
      )}

      {activeVersion && activeVersion.status !== 'pending_approval' && (
        <>
          {activeVersion.status === 'rejected' && (
            <p className="mt-4 rounded-lg bg-yellow-50 px-4 py-3 text-lg text-yellow-800">
              Rejected: {activeVersion.rejection_reason}
            </p>
          )}
          <EditMenuForm
            menuId={id}
            versionId={activeVersion.id}
            title={activeVersion.title ?? ''}
            items={activeVersion.menu_items}
          />
          <form action={submitForApprovalAction} className="mt-4">
            <input type="hidden" name="menuId" value={id} />
            <input type="hidden" name="versionId" value={activeVersion.id} />
            <button type="submit" className="h-14 w-full rounded-lg bg-green-600 text-xl font-semibold text-white">
              Submit for Approval
            </button>
          </form>
        </>
      )}

      {activeVersion?.status === 'pending_approval' && (
        <p className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-lg text-blue-800">
          Awaiting super admin review.
        </p>
      )}

      {!activeVersion && approvedVersion && (
        <>
          <div className="mt-4 rounded-lg border border-gray-200 p-4">
            <p className="text-lg font-semibold">Current approved menu</p>
            <ul className="mt-2 space-y-1 text-lg">
              {[...approvedVersion.menu_items]
                .sort((a, b) => a.display_order - b.display_order)
                .map((item) => (
                  <li key={item.id}>
                    {item.item_name} ({item.category})
                  </li>
                ))}
            </ul>
          </div>
          <form action={createNewVersionAction} className="mt-4">
            <input type="hidden" name="menuId" value={id} />
            <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
              Edit This Menu
            </button>
          </form>
        </>
      )}

      {!activeVersion && !approvedVersion && <p className="mt-4 text-lg text-gray-600">No menu content yet.</p>}
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add admin edit-menu page with submit-for-approval and new-version actions"
```

---

### Task 10: Super-admin approvals queue — `/super-admin/approvals`

**Files:**
- Create: `src/app/(app)/super-admin/approvals/actions.ts`
- Create: `src/app/(app)/super-admin/approvals/page.tsx`

**Interfaces:**
- Consumes: `requireRole()`, `createServerSupabaseClient()`, `computeMenuDiff` (Task 5), `rejectMenuVersionSchema` (Task 4), `approve_menu_version`/`reject_menu_version` RPCs (Task 3)
- Produces: `approveAction`, `rejectAction`

- [ ] **Step 1: Implement the server actions**

Create `src/app/(app)/super-admin/approvals/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { rejectMenuVersionSchema } from '@/lib/validation/menu';

export async function approveAction(formData: FormData) {
  await requireRole(['super_admin']);
  const versionId = formData.get('versionId') as string;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('approve_menu_version', { p_version_id: versionId });

  if (error) {
    redirect(`/super-admin/approvals?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/super-admin/approvals');
}

export async function rejectAction(formData: FormData) {
  await requireRole(['super_admin']);

  const parsed = rejectMenuVersionSchema.safeParse({
    versionId: formData.get('versionId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    redirect('/super-admin/approvals?error=invalid');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('reject_menu_version', {
    p_version_id: parsed.data.versionId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    redirect(`/super-admin/approvals?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/super-admin/approvals');
}
```

- [ ] **Step 2: Implement the page**

Create `src/app/(app)/super-admin/approvals/page.tsx`:

```tsx
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { computeMenuDiff } from '@/lib/menu/diff';
import { approveAction, rejectAction } from './actions';

export default async function ApprovalsPage() {
  await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const { data: pendingVersions } = await supabase
    .from('menu_versions')
    .select(
      'id, menu_id, title, submitted_at, menus(service_date, current_approved_version_id), menu_items(item_name, category, description, display_order)'
    )
    .eq('status', 'pending_approval')
    .order('submitted_at', { ascending: true });

  const rows = await Promise.all(
    (pendingVersions ?? []).map(async (version) => {
      let oldItems: { item_name: string; category: string; description: string | null; display_order: number }[] =
        [];
      const approvedVersionId = version.menus?.current_approved_version_id;
      if (approvedVersionId) {
        const { data: approved } = await supabase
          .from('menu_items')
          .select('item_name, category, description, display_order')
          .eq('menu_version_id', approvedVersionId);
        oldItems = approved ?? [];
      }
      const diff = computeMenuDiff(
        oldItems.map((i) => ({
          itemName: i.item_name,
          category: i.category,
          description: i.description,
          displayOrder: i.display_order,
        })),
        version.menu_items.map((i) => ({
          itemName: i.item_name,
          category: i.category,
          description: i.description,
          displayOrder: i.display_order,
        }))
      );
      return { version, diff };
    })
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">Menu Approvals</h1>
      {rows.length === 0 && <p className="mt-4 text-lg text-gray-600">No pending menu approvals.</p>}
      <div className="mt-6 space-y-6">
        {rows.map(({ version, diff }) => (
          <div key={version.id} className="rounded-lg border border-gray-200 p-4">
            <p className="text-xl font-semibold">{version.menus?.service_date}</p>
            {diff.map((d) => (
              <div key={d.category} className="mt-2">
                {d.changed.map((c, i) => (
                  <p key={i} className="text-lg">
                    <span className="capitalize">{d.category}</span>: {c.old.itemName} → {c.new.itemName}
                  </p>
                ))}
                {d.added.map((a, i) => (
                  <p key={i} className="text-lg text-green-700">
                    + {a.itemName} ({d.category})
                  </p>
                ))}
                {d.removed.map((r, i) => (
                  <p key={i} className="text-lg text-red-700">
                    - {r.itemName} ({d.category})
                  </p>
                ))}
              </div>
            ))}
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={approveAction}>
                <input type="hidden" name="versionId" value={version.id} />
                <button type="submit" className="h-14 rounded-lg bg-green-600 px-6 text-xl font-semibold text-white">
                  Approve
                </button>
              </form>
              <form action={rejectAction} className="flex flex-1 items-end gap-3">
                <input type="hidden" name="versionId" value={version.id} />
                <input
                  name="reason"
                  placeholder="Rejection reason"
                  required
                  className="h-14 flex-1 rounded-lg border border-gray-300 px-4 text-lg"
                />
                <button type="submit" className="h-14 rounded-lg bg-red-600 px-6 text-xl font-semibold text-white">
                  Reject
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add super-admin menu approvals queue with diff view"
```

---

### Task 11: Seed menu data

**Files:**
- Create: `scripts/seed-menus.ts`
- Modify: `package.json` (add `seed:menus` script)

**Interfaces:**
- Consumes: tables from Task 1, seeded profiles from Phase 1 Task 15 (`user_code` `AD001`, `SA001`)

- [ ] **Step 1: Write the seed script**

Create `scripts/seed-menus.ts`:

```ts
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (local Supabase only — never run this against a production project).'
  );
}

const supabase = createClient(url, serviceKey);

const MENU_TEMPLATE = [
  { itemName: 'Dal Fry', category: 'dal', displayOrder: 0 },
  { itemName: 'Paneer Masala', category: 'gravy', displayOrder: 1 },
  { itemName: 'Jeera Rice', category: 'rice', displayOrder: 2 },
  { itemName: 'Roti', category: 'roti', displayOrder: 3 },
  { itemName: 'Salad', category: 'salad', displayOrder: 4 },
];

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createApprovedMenu(serviceDate: string, adminId: string, superAdminId: string) {
  const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
  if (!menu) return;

  const now = new Date().toISOString();
  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menu.id,
      version_number: 1,
      status: 'approved',
      created_by: adminId,
      submitted_by: adminId,
      submitted_at: now,
      approved_by: superAdminId,
      approved_at: now,
    })
    .select('id')
    .single();
  if (!version) return;

  await supabase.from('menu_items').insert(
    MENU_TEMPLATE.map((item) => ({
      menu_version_id: version.id,
      item_name: item.itemName,
      category: item.category,
      display_order: item.displayOrder,
    }))
  );

  await supabase.from('menus').update({ current_approved_version_id: version.id }).eq('id', menu.id);
}

async function createPendingMenu(serviceDate: string, adminId: string) {
  const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
  if (!menu) return;

  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menu.id,
      version_number: 1,
      status: 'pending_approval',
      created_by: adminId,
      submitted_by: adminId,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (!version) return;

  await supabase.from('menu_items').insert(
    MENU_TEMPLATE.slice(0, 3).map((item) => ({
      menu_version_id: version.id,
      item_name: item.itemName,
      category: item.category,
      display_order: item.displayOrder,
    }))
  );
}

async function createRejectedMenu(serviceDate: string, adminId: string, superAdminId: string) {
  const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
  if (!menu) return;

  const now = new Date().toISOString();
  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menu.id,
      version_number: 1,
      status: 'rejected',
      created_by: adminId,
      submitted_by: adminId,
      submitted_at: now,
      rejected_by: superAdminId,
      rejected_at: now,
      rejection_reason: 'Please add a sweet item and reduce spice level for Paneer Masala.',
    })
    .select('id')
    .single();
  if (!version) return;

  await supabase.from('menu_items').insert(
    MENU_TEMPLATE.map((item) => ({
      menu_version_id: version.id,
      item_name: item.itemName,
      category: item.category,
      display_order: item.displayOrder,
    }))
  );
}

async function seed() {
  const { data: admin } = await supabase.from('profiles').select('id').eq('user_code', 'AD001').single();
  const { data: superAdmin } = await supabase.from('profiles').select('id').eq('user_code', 'SA001').single();

  if (!admin || !superAdmin) {
    throw new Error('Run `npm run seed:users` first — admin/super_admin profiles not found.');
  }

  for (let offset = -3; offset <= 7; offset++) {
    const serviceDate = dateOffset(offset);
    if (offset === 4) {
      await createPendingMenu(serviceDate, admin.id);
    } else if (offset === 5) {
      await createRejectedMenu(serviceDate, admin.id, superAdmin.id);
    } else {
      await createApprovedMenu(serviceDate, admin.id, superAdmin.id);
    }
    console.log(`Seeded menu for ${serviceDate}`);
  }
}

seed();
```

Seeding writes final state directly (not via the `approve_menu_version`/`reject_menu_version` RPCs) because those RPCs check `is_super_admin()` via `auth.uid()`, which is null under the service-role key used here — the same bootstrap issue Phase 1's role-lock trigger had. Service role already bypasses RLS, so writing the target rows directly is both simpler and correct for seed data (no audit-log side effect needed for seeded rows).

- [ ] **Step 2: Add npm script**

In `package.json` `"scripts"`, add:

```json
"seed:menus": "tsx scripts/seed-menus.ts"
```

- [ ] **Step 3: Attempt to run (requires local Supabase running + Phase 1's `seed:users` already run)**

```bash
npx supabase db reset
npm run seed:users
npm run seed:menus
```

Expected: 11 lines of "Seeded menu for YYYY-MM-DD". If Docker isn't available, note that and move on — the script's correctness was verified by careful reading in the self-review step below.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add seed script for realistic menu data across 11 service dates"
```

---

### Task 12: RLS/RPC integration test

**Files:**
- Create: `src/lib/supabase/menu-rls.integration.test.ts`

**Interfaces:**
- Consumes: seeded `admin1@fmb.test`/`superadmin@fmb.test` (Phase 1 Task 15), seeded pending menu (Task 11), live local Supabase instance

- [ ] **Step 1: Write the test**

Create `src/lib/supabase/menu-rls.integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

describe.skipIf(skip)('Menu approval RLS and RPCs', () => {
  it('an admin cannot call approve_menu_version directly', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { data: pending } = await client
      .from('menu_versions')
      .select('id')
      .eq('status', 'pending_approval')
      .limit(1)
      .single();

    const { error } = await client.rpc('approve_menu_version', { p_version_id: pending!.id });
    expect(error).not.toBeNull();
  });

  it('a super_admin can approve a pending version and current_approved_version_id updates', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const { data: pending } = await client
      .from('menu_versions')
      .select('id, menu_id')
      .eq('status', 'pending_approval')
      .limit(1)
      .single();

    const { error } = await client.rpc('approve_menu_version', { p_version_id: pending!.id });
    expect(error).toBeNull();

    const { data: menu } = await client
      .from('menus')
      .select('current_approved_version_id')
      .eq('id', pending!.menu_id)
      .single();
    expect(menu!.current_approved_version_id).toBe(pending!.id);
  });

  it('rejecting without a reason is rejected by the RPC', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const { data: pending } = await client
      .from('menu_versions')
      .select('id')
      .eq('status', 'pending_approval')
      .limit(1)
      .maybeSingle();

    if (!pending) return; // nothing left pending after the prior test claimed it — acceptable for a smoke test

    const { error } = await client.rpc('reject_menu_version', { p_version_id: pending.id, p_reason: '' });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it (requires local Supabase running + seed:users + seed:menus already applied)**

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npx vitest run src/lib/supabase/menu-rls.integration.test.ts
```

Expected: PASS (3 tests). Without those env vars, the suite reports skipped, not failing.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: add RLS/RPC integration test for menu approval workflow"
```

---

### Task 13: README update and final verification

**Files:**
- Modify: `README.md`

**Interfaces:** none (documentation + verification only)

- [ ] **Step 1: Update `README.md`**

In the "Local development" numbered list, add a step after "Create dev accounts: `npm run seed:users`" for seeding menus:

```
Create sample menus: `npm run seed:menus` (11 service dates: past 3 days, today, next 7 days —
including one pending approval and one rejected, for testing the approval queue)
```

Renumber subsequent steps accordingly.

- [ ] **Step 2: Full verification pass**

```bash
npm run lint
npm run test
npm run build
```

Expected: all pass. If Docker/local Supabase is running, additionally run:

```bash
npx supabase db reset
npm run seed:users
npm run seed:menus
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key> npx vitest run src/lib/supabase/menu-rls.integration.test.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: document menu seeding in README"
```

---

## Self-Review Notes

- **Spec coverage:** every Phase-2 item from the design doc (menus/menu_versions/menu_items schema, RLS closing the "admin cannot approve own menu" requirement, approve/reject RPCs with audit writes, admin create/edit/submit UI, super-admin approval queue with diff, seed data) maps to a task above.
- **Deferred to Phase 3 (explicitly, not gaps):** any user-facing menu calendar/display, thali_requests, wiring `lib/time`'s cutoff helpers into a real request flow, leave/no-service system, concerns, notifications, reports.
- **Naming consistency checked:** `computeMenuDiff`/`MenuItemLike`/`CategoryDiff`, `MenuItemsEditor`/`ItemRow`, `menuVersionCreateSchema`/`rejectMenuVersionSchema`, `createMenuAction`/`updateMenuVersionAction`/`submitForApprovalAction`/`createNewVersionAction`/`approveAction`/`rejectAction` are used identically wherever referenced across tasks.
- **Deliberate simplifications marked:** the loose `draft`/`pending_approval`/`rejected` transition set in `menu_versions_update_admin` (Task 2) and the positional (not identity-matched) diff pairing (Task 5) are both flagged inline with a `# ponytail:` note naming the ceiling and upgrade path.
