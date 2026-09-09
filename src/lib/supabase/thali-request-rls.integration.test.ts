import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { isBeforeCutoff } from '@/lib/time/cutoff';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

describe.skipIf(skip)('Thali request RLS and cutoff', () => {
  it('a user can submit a future request and update it without creating a duplicate row', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const { data: gravy } = await client.from('portion_options').select('id').eq('category', 'gravy').limit(1).single();
    const { data: rice } = await client.from('portion_options').select('id').eq('category', 'rice').limit(1).single();

    const future = new Date();
    future.setDate(future.getDate() + 30);
    const serviceDate = future.toISOString().slice(0, 10);

    const { error: insertError } = await client.from('thali_requests').upsert(
      {
        user_id: userId,
        service_date: serviceDate,
        wants_thali: true,
        gravy_portion_id: gravy!.id,
        rice_portion_id: rice!.id,
        roti_quantity: 3,
      },
      { onConflict: 'user_id,service_date' }
    );
    expect(insertError).toBeNull();

    const { error: updateError } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false, gravy_portion_id: null, rice_portion_id: null, roti_quantity: null }, { onConflict: 'user_id,service_date' });
    expect(updateError).toBeNull();

    const { data: rows } = await client.from('thali_requests').select('id, wants_thali').eq('service_date', serviceDate);
    expect(rows).toHaveLength(1);
    expect(rows![0].wants_thali).toBe(false);
  });

  it('a user cannot submit or modify a request after cutoff', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user2@fmb.test', password: 'DevPass123!' });
    const userId = (await client.auth.getUser()).data.user!.id;

    const past = new Date();
    past.setDate(past.getDate() - 5);
    const serviceDate = past.toISOString().slice(0, 10);

    const { error } = await client
      .from('thali_requests')
      .upsert({ user_id: userId, service_date: serviceDate, wants_thali: false }, { onConflict: 'user_id,service_date' });
    expect(error).not.toBeNull();
  });

  it("a user cannot read another user's thali_requests rows", async () => {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const adminClient = createClient(url!, serviceKey || anonKey!);
    await adminClient.auth.signInWithPassword({ email: 'superadmin@fmb.test', password: 'DevPass123!' });

    const { data: otherUser } = await adminClient.from('profiles').select('id').eq('user_code', 'US002').single();

    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const { data: rows } = await client.from('thali_requests').select('id').eq('user_id', otherUser!.id);
    expect(rows).toHaveLength(0);
  });

  it('the SQL is_before_request_cutoff() function agrees with the TS isBeforeCutoff() helper', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const future = new Date();
    future.setDate(future.getDate() + 60);
    const serviceDate = future.toISOString().slice(0, 10);

    const tsResult = isBeforeCutoff(serviceDate, 'Asia/Kolkata', '18:00');
    const { data, error } = await client.rpc('is_before_request_cutoff', { p_service_date: serviceDate });
    expect(error).toBeNull();
    expect(data).toBe(tsResult);
  });
});
