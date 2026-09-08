import type { SupabaseClient } from '@supabase/supabase-js';

export const SETTINGS_KEYS = {
  APP_NAME: 'app_name',
  ORG_NAME: 'org_name',
  TIMEZONE: 'timezone',
  CUTOFF_TIME: 'cutoff_time',
  ROTI_MIN_QTY: 'roti_min_qty',
  ROTI_MAX_QTY: 'roti_max_qty',
} as const;

export type SettingKey = (typeof SETTINGS_KEYS)[keyof typeof SETTINGS_KEYS];

export async function getSetting<T = unknown>(
  supabase: SupabaseClient,
  key: SettingKey
): Promise<T | null> {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .single();
  if (error || !data) return null;
  return (data as { value: T }).value;
}

export async function getSettings(
  supabase: SupabaseClient,
  keys: SettingKey[]
): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
  if (error || !data) return {};
  return Object.fromEntries(
    (data as { key: string; value: unknown }[]).map((row) => [row.key, row.value])
  );
}
