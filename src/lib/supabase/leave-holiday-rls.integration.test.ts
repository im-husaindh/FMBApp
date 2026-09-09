import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = !url || !anonKey || !serviceKey;

describe.skipIf(skip)('Leave and service-holiday enforcement', () => {
  it('a user on leave cannot submit a thali request for a leave date', async () => {
    const adminClient = createClient(url!, serviceKey!);
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const future = new Date();
    future.setDate(future.getDate() + 40);
    const serviceDate = future.toISOString().slice(0, 10);

    const { data: admin } = await adminClient.from('profiles').select('id').eq('user_code', 'AD001').single();
    await adminClient
      .from('user_leaves')
      .insert({ user_id: userId, from_date: serviceDate, to_date: serviceDate, entered_by: admin!.id });

    const { error } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(error).not.toBeNull();
  });

  it('no user can submit a thali request for a service-holiday date', async () => {
    const adminClient = createClient(url!, serviceKey!);
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const future = new Date();
    future.setDate(future.getDate() + 41);
    const serviceDate = future.toISOString().slice(0, 10);

    const { data: superAdmin } = await adminClient.from('profiles').select('id').eq('user_code', 'SA001').single();
    await adminClient
      .from('service_holidays')
      .insert({ service_date: serviceDate, reason: 'Test holiday', created_by: superAdmin!.id });

    const { error } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(error).not.toBeNull();
  });

  it('is_on_leave agrees with direct table state', async () => {
    const adminClient = createClient(url!, serviceKey!);

    const future = new Date();
    future.setDate(future.getDate() + 42);
    const serviceDate = future.toISOString().slice(0, 10);

    const { data: user } = await adminClient.from('profiles').select('id').eq('user_code', 'US003').single();
    const { data: admin } = await adminClient.from('profiles').select('id').eq('user_code', 'AD001').single();
    await adminClient
      .from('user_leaves')
      .insert({ user_id: user!.id, from_date: serviceDate, to_date: serviceDate, entered_by: admin!.id });

    const { data: onLeave, error } = await adminClient.rpc('is_on_leave', {
      p_user_id: user!.id,
      p_service_date: serviceDate,
    });
    expect(error).toBeNull();
    expect(onLeave).toBe(true);

    const { data: notOnLeave } = await adminClient.rpc('is_on_leave', {
      p_user_id: user!.id,
      p_service_date: '2020-01-01',
    });
    expect(notOnLeave).toBe(false);
  });
});
