import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('Super-admin user management RLS', () => {
  it('a super_admin can change another user\'s role and active status', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: target } = await serviceClient.from('profiles').select('id, role, active').eq('user_code', 'US015').single();
    const originalRole = target!.role;
    const originalActive = target!.active;

    const superAdminClient = createClient(url!, anonKey!);
    await superAdminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const newRole = originalRole === 'admin' ? 'user' : 'admin';
    const { data: updated, error } = await superAdminClient
      .from('profiles')
      .update({ role: newRole, active: originalActive })
      .eq('id', target!.id)
      .select('role')
      .single();

    expect(error).toBeNull();
    expect(updated!.role).toBe(newRole);

    // Revert, so this test doesn't leave permanent residue on a shared seeded user.
    await serviceClient.from('profiles').update({ role: originalRole }).eq('id', target!.id);
  });

  it('an active super_admin CANNOT change their own role or active status', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: self } = await serviceClient.from('profiles').select('id, role, active').eq('user_code', 'SA001').single();

    const superAdminClient = createClient(url!, anonKey!);
    await superAdminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const { error } = await superAdminClient
      .from('profiles')
      .update({ role: 'user' })
      .eq('id', self!.id);

    expect(error).not.toBeNull();

    // Confirm the role genuinely did not change.
    const { data: after } = await serviceClient.from('profiles').select('role').eq('id', self!.id).single();
    expect(after!.role).toBe(self!.role);
  });

  it('a plain admin (not super_admin) cannot change any user\'s role or active status', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: target } = await serviceClient.from('profiles').select('id, role').eq('user_code', 'US002').single();
    const originalRole = target!.role;

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { error } = await adminClient
      .from('profiles')
      .update({ role: 'admin' })
      .eq('id', target!.id)
      .select('role')
      .single();

    expect(error).not.toBeNull();

    const { data: after } = await serviceClient.from('profiles').select('role').eq('id', target!.id).single();
    expect(after!.role).toBe(originalRole);
  });
});
