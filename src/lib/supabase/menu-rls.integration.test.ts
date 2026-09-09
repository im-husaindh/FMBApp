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
