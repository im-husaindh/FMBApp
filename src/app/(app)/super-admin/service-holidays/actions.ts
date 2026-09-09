'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { serviceHolidayCreateSchema } from '@/lib/validation/leave';

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

  const { error } = await supabase.from('service_holidays').insert({
    service_date: parsed.data.serviceDate,
    reason: parsed.data.reason,
    created_by: profile.id,
  });

  if (error) {
    if (error.code === '23505') {
      redirect('/super-admin/service-holidays?error=duplicate');
    }
    redirect('/super-admin/service-holidays?error=save_failed');
  }

  redirect('/super-admin/service-holidays');
}
