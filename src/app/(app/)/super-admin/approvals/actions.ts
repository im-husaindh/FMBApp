'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { rejectMenuVersionSchema } from '@/lib/validation/menu';

export async function approveAction(formData: FormData) {
  await requireRole(['super_admin']);
  const versionId = formData.get('versionId') as string;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('approve_menu_version', { p_version_id: versionId });

  if (error) {
    redirect(`/super-admin/approvals?error=${encodeURIComponent(error.message)}`);
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
    redirect(`/super-admin/approvals?error=${encodeURIComponent(error.message)}`);
  }

  redirect('/super-admin/approvals');
}
