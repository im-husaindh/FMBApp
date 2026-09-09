import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

type PendingVersionRow = {
  id: string;
  menu_id: string;
  menus: { current_approved_version_id: string | null } | null;
};

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

  it('a super_admin can approve a pending version, current_approved_version_id updates, and the old approved version becomes superseded', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    // Pick the pending version whose menu already has an approved version — that's the
    // one seeded specifically to exercise the RPC's "old approved version becomes
    // superseded" branch (see scripts/seed-menus.ts, offset 4).
    const { data: pendingVersions } = await client
      .from('menu_versions')
      .select('id, menu_id, menus!menu_versions_menu_id_fkey(current_approved_version_id)')
      .eq('status', 'pending_approval')
      .overrideTypes<Array<PendingVersionRow>, { merge: false }>();

    const pending = pendingVersions?.find((v) => v.menus?.current_approved_version_id);
    expect(pending).toBeTruthy();
    const oldApprovedVersionId = pending!.menus!.current_approved_version_id!;

    const { error } = await client.rpc('approve_menu_version', { p_version_id: pending!.id });
    expect(error).toBeNull();

    const { data: menu } = await client
      .from('menus')
      .select('current_approved_version_id')
      .eq('id', pending!.menu_id)
      .single();
    expect(menu!.current_approved_version_id).toBe(pending!.id);

    const { data: oldVersion } = await client
      .from('menu_versions')
      .select('status')
      .eq('id', oldApprovedVersionId)
      .single();
    expect(oldVersion!.status).toBe('superseded');
  });

  it('rejecting without a reason is rejected by the RPC', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    // The prior test consumed the only pending version tied to an already-approved menu
    // (see seed offset 4); this one uses the independent pending-only menu (seed offset 6)
    // so this test exercises a real rejection attempt rather than short-circuiting.
    const { data: pending } = await client
      .from('menu_versions')
      .select('id')
      .eq('status', 'pending_approval')
      .limit(1)
      .single();

    const { error } = await client.rpc('reject_menu_version', { p_version_id: pending!.id, p_reason: '' });
    expect(error).not.toBeNull();
  });
});
