import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const skip = !url || !anonKey;

describe.skipIf(skip)('RLS: profiles and app_settings', () => {
  it("a user cannot read another user's profile row", async () => {
    const client = createClient(url!, anonKey!);
    const { error: signInError } = await client.auth.signInWithPassword({
      email: 'user1@fmb.test',
      password: 'DevPass123!',
    });
    expect(signInError).toBeNull();

    const {
      data: { user },
    } = await client.auth.getUser();
    const { data: others } = await client.from('profiles').select('id').neq('id', user!.id);

    expect(others).toEqual([]);
  });

  it('a user cannot write app_settings', async () => {
    const client = createClient(url!, anonKey!);
    await client.auth.signInWithPassword({ email: 'user1@fmb.test', password: 'DevPass123!' });

    const { error } = await client
      .from('app_settings')
      .update({ value: '"tampered"' })
      .eq('key', 'cutoff_time');

    expect(error).not.toBeNull();
  });
});
