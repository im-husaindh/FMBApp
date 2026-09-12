'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff } from '@/lib/time/cutoff';
import { thaliRequestSchema } from '@/lib/validation/thali-request';

export async function submitThaliRequestAction(formData: FormData) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const serviceDate = formData.get('serviceDate') as string;

  const settings = await getSettings(supabase, [
    SETTINGS_KEYS.CUTOFF_TIME,
    SETTINGS_KEYS.TIMEZONE,
    SETTINGS_KEYS.ROTI_MIN_QTY,
    SETTINGS_KEYS.ROTI_MAX_QTY,
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '23:30';
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const parsed = thaliRequestSchema(rotiMin, rotiMax).safeParse({
    serviceDate,
    wantsThali: formData.get('wantsThali'),
    gravyPortionId: formData.get('gravyPortionId'),
    ricePortionId: formData.get('ricePortionId'),
    rotiQuantity: formData.get('rotiQuantity'),
  });

  if (!parsed.success) {
    redirect('/dashboard?error=invalid');
  }

  if (!isBeforeCutoff(serviceDate, timezone, cutoffTime)) {
    redirect('/dashboard?error=cutoff_passed');
  }

  const [{ data: leaveRows }, { data: holidayRows }] = await Promise.all([
    supabase
      .from('user_leaves')
      .select('id')
      .eq('user_id', profile.id)
      .lte('from_date', serviceDate)
      .gte('to_date', serviceDate),
    supabase.from('service_holidays').select('id').eq('service_date', serviceDate),
  ]);

  if ((leaveRows?.length ?? 0) > 0 || (holidayRows?.length ?? 0) > 0) {
    redirect('/dashboard?error=unavailable');
  }

  const { error } = await supabase.from('thali_requests').upsert(
    {
      user_id: profile.id,
      service_date: parsed.data.serviceDate,
      wants_thali: parsed.data.wantsThali,
      gravy_portion_id: parsed.data.wantsThali ? parsed.data.gravyPortionId : null,
      rice_portion_id: parsed.data.wantsThali ? parsed.data.ricePortionId : null,
      roti_quantity: parsed.data.wantsThali ? parsed.data.rotiQuantity : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,service_date' }
  );

  if (error) {
    // The only realistic causes at this point (shape already validated, leave/holiday
    // already checked above) are the RLS with-check's cutoff/leave/holiday conditions
    // failing due to a race between page load and submit.
    redirect('/dashboard?error=unavailable');
  }

  redirect('/dashboard');
}
