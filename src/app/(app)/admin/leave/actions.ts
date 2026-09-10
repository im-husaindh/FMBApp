'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { leaveCreateSchema } from '@/lib/validation/leave';
import { logAuditEvent } from '@/lib/audit';

export async function createLeaveAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const userCode = (formData.get('userCode') as string | null)?.trim().toUpperCase();
  const { data: user } = userCode
    ? await supabase.from('profiles').select('id').eq('user_code', userCode).maybeSingle()
    : { data: null };

  if (!user) {
    redirect('/admin/leave?error=user_not_found');
  }

  const parsed = leaveCreateSchema.safeParse({
    userId: user.id,
    fromDate: formData.get('fromDate'),
    toDate: formData.get('toDate'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    redirect('/admin/leave?error=invalid');
  }

  const { data: overlapping } = await supabase
    .from('user_leaves')
    .select('id')
    .eq('user_id', parsed.data.userId)
    .lte('from_date', parsed.data.toDate)
    .gte('to_date', parsed.data.fromDate);

  if (overlapping && overlapping.length > 0) {
    redirect('/admin/leave?error=overlap');
  }

  const { data: newLeave, error } = await supabase
    .from('user_leaves')
    .insert({
      user_id: parsed.data.userId,
      from_date: parsed.data.fromDate,
      to_date: parsed.data.toDate,
      reason: parsed.data.reason || null,
      entered_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !newLeave) {
    redirect('/admin/leave?error=save_failed');
  }

  await logAuditEvent(supabase, {
    action: 'leave_created',
    entityType: 'user_leave',
    entityId: newLeave!.id,
    newState: {
      userId: parsed.data.userId,
      fromDate: parsed.data.fromDate,
      toDate: parsed.data.toDate,
      reason: parsed.data.reason || null,
    },
  });

  redirect('/admin/leave');
}
