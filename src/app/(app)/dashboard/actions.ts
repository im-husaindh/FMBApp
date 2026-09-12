'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff } from '@/lib/time/cutoff';
import { multiDayRequestSchema } from '@/lib/validation/thali-request';

export async function submitMultiDayRequestsAction(formData: FormData) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const raw = formData.get('multiDayRequests');
  if (typeof raw !== 'string') {
    redirect('/dashboard?error=invalid');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    redirect('/dashboard?error=invalid');
  }

  const settings = await getSettings(supabase, [
    SETTINGS_KEYS.CUTOFF_TIME,
    SETTINGS_KEYS.TIMEZONE,
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '23:30';
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';

  const result = multiDayRequestSchema().safeParse(parsed);
  if (!result.success) {
    redirect('/dashboard?error=invalid');
  }

  const items = result.data;

  // Server-side cutoff guard
  for (const item of items) {
    if (!isBeforeCutoff(item.serviceDate, timezone, cutoffTime)) {
      redirect('/dashboard?error=cutoff_passed');
    }
  }

  // Leave and holiday checks
  const dates = items.map((i) => i.serviceDate);
  const [{ data: leaveRows }, { data: holidayRows }] = await Promise.all([
    supabase
      .from('user_leaves')
      .select('from_date, to_date')
      .eq('user_id', profile.id)
      .lte('from_date', dates[dates.length - 1])
      .gte('to_date', dates[0]),
    supabase.from('service_holidays').select('service_date').in('service_date', dates),
  ]);

  const holidayDates = new Set((holidayRows ?? []).map((h) => h.service_date));
  for (const item of items) {
    if (holidayDates.has(item.serviceDate)) {
      redirect('/dashboard?error=unavailable');
    }
    for (const leave of leaveRows ?? []) {
      if (leave.from_date <= item.serviceDate && item.serviceDate <= leave.to_date) {
        redirect('/dashboard?error=unavailable');
      }
    }
  }

  // Bulk upsert
  const rows = items.map((item) => ({
    user_id: profile.id,
    service_date: item.serviceDate,
    wants_thali: item.wantsThali,
    item_quantities: item.itemQuantities,
    // clear old per-category fields that the new model replaces
    gravy_portion_id: null,
    rice_portion_id: null,
    roti_quantity: null,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('thali_requests')
    .upsert(rows, { onConflict: 'user_id,service_date' });

  if (error) {
    redirect('/dashboard?error=unavailable');
  }

  redirect('/dashboard');
}
