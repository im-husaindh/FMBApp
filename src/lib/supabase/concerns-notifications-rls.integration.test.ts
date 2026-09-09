import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('Concerns, concern_updates, and notifications RLS', () => {
  it('a user cannot read another user\'s concerns', async () => {
    const ownerClient = createClient(url!, anonKey!);
    await ownerClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const ownerId = (await ownerClient.auth.getUser()).data.user!.id;

    const { data: concern } = await ownerClient
      .from('concerns')
      .insert({ user_id: ownerId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern' })
      .select('id')
      .single();

    const otherClient = createClient(url!, anonKey!);
    await otherClient.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });

    const { data } = await otherClient.from('concerns').select('id').eq('id', concern!.id);
    expect(data).toHaveLength(0);
  });

  it('an admin can read any user\'s concerns', async () => {
    const ownerClient = createClient(url!, anonKey!);
    await ownerClient.auth.signInWithPassword({ email: 'user3@fmb.test', password: 'DevPass123!' });
    const ownerId = (await ownerClient.auth.getUser()).data.user!.id;

    const { data: concern } = await ownerClient
      .from('concerns')
      .insert({ user_id: ownerId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern 2' })
      .select('id')
      .single();

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { data } = await adminClient.from('concerns').select('id').eq('id', concern!.id);
    expect(data).toHaveLength(1);
  });

  it('a regular user cannot insert into concern_updates', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const { data: concern } = await client
      .from('concerns')
      .insert({ user_id: userId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern 3' })
      .select('id')
      .single();

    const { error } = await client
      .from('concern_updates')
      .insert({ concern_id: concern!.id, new_status: 'reviewing', changed_by: userId });
    expect(error).not.toBeNull();
  });

  it('notify() writes a row that only its recipient can read', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: recipient } = await serviceClient.from('profiles').select('id').eq('user_code', 'US001').single();
    const { data: inserted, error: insertError } = await serviceClient
      .from('notifications')
      .insert({ recipient_id: recipient!.id, type: 'concern_response', payload: {} })
      .select('id')
      .single();
    expect(insertError).toBeNull();

    const recipientClient = createClient(url!, anonKey!);
    await recipientClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const { data: ownData } = await recipientClient.from('notifications').select('id').eq('id', inserted!.id);
    expect(ownData).toHaveLength(1);

    const otherClient = createClient(url!, anonKey!);
    await otherClient.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });
    const { data: otherData } = await otherClient.from('notifications').select('id').eq('id', inserted!.id);
    expect(otherData).toHaveLength(0);
  });

  it('a user cannot mark another user\'s notification as read', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: recipient } = await serviceClient.from('profiles').select('id').eq('user_code', 'US002').single();
    const { data: inserted } = await serviceClient
      .from('notifications')
      .insert({ recipient_id: recipient!.id, type: 'concern_response', payload: {} })
      .select('id')
      .single();

    const otherClient = createClient(url!, anonKey!);
    await otherClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const { data: updateResult } = await otherClient
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('id', inserted!.id)
      .select('id');
    expect(updateResult).toHaveLength(0);
  });

  it('an admin can insert into notifications via an ordinary anon-key client', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: recipient } = await serviceClient.from('profiles').select('id').eq('user_code', 'US001').single();

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { error } = await adminClient
      .from('notifications')
      .insert({ recipient_id: recipient!.id, type: 'concern_response', payload: {} });
    expect(error).toBeNull();
  });

  it('a regular user cannot insert into notifications', async () => {
    const serviceClient = createClient(url!, serviceKey!);
    const { data: recipient } = await serviceClient.from('profiles').select('id').eq('user_code', 'US002').single();

    const userClient = createClient(url!, anonKey!);
    await userClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const { error } = await userClient
      .from('notifications')
      .insert({ recipient_id: recipient!.id, type: 'concern_response', payload: {} });
    expect(error).not.toBeNull();
  });

  it('a regular user cannot update their own concern\'s status, but an admin can', async () => {
    const ownerClient = createClient(url!, anonKey!);
    await ownerClient.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const ownerId = (await ownerClient.auth.getUser()).data.user!.id;

    const { data: concern } = await ownerClient
      .from('concerns')
      .insert({ user_id: ownerId, concern_date: '2026-09-10', category: 'other', message: 'RLS test concern 4' })
      .select('id')
      .single();

    const { data: ownUpdateResult } = await ownerClient
      .from('concerns')
      .update({ status: 'reviewing' })
      .eq('id', concern!.id)
      .select('id');
    expect(ownUpdateResult).toHaveLength(0);

    const adminClient = createClient(url!, anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'admin1@fmb.test', password: 'DevPass123!' });

    const { data: adminUpdateResult } = await adminClient
      .from('concerns')
      .update({ status: 'reviewing' })
      .eq('id', concern!.id)
      .select('id');
    expect(adminUpdateResult).toHaveLength(1);
  });
});
