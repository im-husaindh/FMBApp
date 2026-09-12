'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { rejectMenuVersionSchema } from '@/lib/validation/menu';
import { notifyMany, NOTIFICATION_TYPES } from '@/lib/notifications';

export async function approveAction(formData: FormData) {
  await requireRole(['super_admin']);
  const versionId = formData.get('versionId') as string;

  const supabase = await createServerSupabaseClient();

  // Fetch service_date before approving so we can include it in the notification
  const { data: version } = await supabase
    .from('menu_versions')
    .select('menus!menu_versions_menu_id_fkey(service_date)')
    .eq('id', versionId)
    .single();

  const { error } = await supabase.rpc('approve_menu_version', { p_version_id: versionId });

  if (error) {
    redirect('/super-admin/approvals?error=action_failed');
  }

  // Notify all active users about the newly approved menu
  const menusData = version?.menus as unknown as { service_date: string } | null;
  const serviceDate = menusData?.service_date ?? null;
  if (serviceDate) {
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .eq('active', true);
    const ids = (users ?? []).map((u) => u.id);
    await notifyMany(supabase, ids, NOTIFICATION_TYPES.MENU_APPROVED, { serviceDate });
  }

  redirect('/super-admin/approvals');
}

export async function rejectAction(formData: FormData) {
  await requireRole(['super_admin']);

  const parsed = rejectMenuVersionSchema.safeParse({
    versionId: formData.get('versionId'),
    reason: formData.get('reason'),
  });

  if (!parsed.success) {
    redirect('/super-admin/approvals?error=invalid');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('reject_menu_version', {
    p_version_id: parsed.data.versionId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    redirect('/super-admin/approvals?error=action_failed');
  }

  redirect('/super-admin/approvals');
}
