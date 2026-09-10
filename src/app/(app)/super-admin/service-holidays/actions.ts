'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceHolidayCreateSchema } from '@/lib/validation/leave';
import { logAuditEvent } from '@/lib/audit';

export async function createServiceHolidayAction(formData: FormData) {
  const profile = await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const parsed = serviceHolidayCreateSchema.safeParse({
    serviceDate: formData.get('serviceDate'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    redirect('/super-admin/service-holidays?error=invalid');
  }

  const { data: newHoliday, error } = await supabase
    .from('service_holidays')
    .insert({
      service_date: parsed.data.serviceDate,
      reason: parsed.data.reason,
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !newHoliday) {
    if (error?.code === '23505') {
      redirect('/super-admin/service-holidays?error=duplicate');
    }
    redirect('/super-admin/service-holidays?error=save_failed');
  }

  await logAuditEvent(supabase, {
    action: 'service_holiday_created',
    entityType: 'service_holiday',
    entityId: newHoliday!.id,
    newState: { serviceDate: parsed.data.serviceDate, reason: parsed.data.reason },
  });

  redirect('/super-admin/service-holidays');
}
