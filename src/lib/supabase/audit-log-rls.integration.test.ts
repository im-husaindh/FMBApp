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
