'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { updateUserSchema } from '@/lib/validation/user-admin';
import { logAuditEvent } from '@/lib/audit';
import { computeUserAuditEvents } from '@/lib/audit/user-change-events';

export async function updateUserAction(formData: FormData) {
  const profile = await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const targetId = formData.get('userId') as string;

  const parsed = updateUserSchema.safeParse({
    fullName: formData.get('fullName'),
    mobile: formData.get('mobile'),
    email: formData.get('email'),
    role: formData.get('role'),
    active: formData.get('active'),
  });

  if (!parsed.success) {
    redirect(`/super-admin/users/${targetId}?error=invalid`);
  }

  // Fetched unconditionally now (not just for the self-target case): the
  // audit trail needs the previous state for every edit, and this same
  // fetch also feeds the self-lock check below.
  const { data: current, error: currentError } = await supabase
    .from('profiles')
    .select('full_name, mobile, email, role, active')
    .eq('id', targetId)
    .maybeSingle();

  if (currentError || !current) {
    redirect(`/super-admin/users/${targetId}?error=save_failed`);
  }

  // Contact-info edits on a super_admin's own row are fine — only a role or
  // active-status CHANGE on their own row is rejected. The edit page's own
  // UI never lets a self-viewer submit a changed role/active value (see
  // Task 4 Step 2), so this only fires if that's somehow bypassed.
  if (targetId === profile.id && (current!.role !== parsed.data.role || current!.active !== parsed.data.active)) {
    redirect(`/super-admin/users/${targetId}?error=self_lock`);
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      email: parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    })
    .eq('id', targetId);

  if (error) {
    redirect(`/super-admin/users/${targetId}?error=save_failed`);
  }

  const events = computeUserAuditEvents(
    targetId,
    {
      fullName: current!.full_name,
      mobile: current!.mobile,
      email: current!.email,
      role: current!.role,
      active: current!.active,
    },
    {
      fullName: parsed.data.fullName,
      mobile: parsed.data.mobile || null,
      email: parsed.data.email,
      role: parsed.data.role,
      active: parsed.data.active,
    }
  );
  for (const event of events) {
    await logAuditEvent(supabase, event);
  }

  redirect(`/super-admin/users/${targetId}?saved=1`);
}

export async function sendPasswordResetAction(formData: FormData) {
  await requireRole(['super_admin']);
  const supabase = await createServerSupabaseClient();

  const targetId = formData.get('userId') as string;
  const targetEmail = formData.get('email') as string;

  const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
    redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
  });

  if (error) {
    redirect(`/super-admin/users/${targetId}?error=reset_failed`);
  }

  redirect(`/super-admin/users/${targetId}?reset_sent=1`);
}
