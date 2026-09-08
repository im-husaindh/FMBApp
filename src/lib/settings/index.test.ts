import { describe, it, expect } from 'vitest';
import { getSetting, SETTINGS_KEYS } from './index';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockSupabase(result: { data: unknown; error: unknown }): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => result,
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe('getSetting', () => {
  it('returns the value on success', async () => {
    const supabase = mockSupabase({ data: { value: '18:00' }, error: null });
    const result = await getSetting(supabase, SETTINGS_KEYS.CUTOFF_TIME);
    expect(result).toBe('18:00');
  });

  it('returns null on error', async () => {
    const supabase = mockSupabase({ data: null, error: { message: 'not found' } });
    const result = await getSetting(supabase, SETTINGS_KEYS.CUTOFF_TIME);
    expect(result).toBeNull();
  });
});
