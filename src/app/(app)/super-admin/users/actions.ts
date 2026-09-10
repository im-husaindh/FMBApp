'use server';

import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { inviteUserSchema } from '@/lib/validation/user-admin';
import { logAuditEvent } from '@/lib/audit';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function inviteUserAction(formData: FormData) {
  // Authorization always runs on the caller's own ordinary session first —
  // the service-role client constructed below is never used for this check.
  await requireRole(['super_admin']);

  const parsed = inviteUserSchema.safeParse({
    fullName: formData.get('fullName'),
    email: formData.get('email'),
    userCode: formData.get('userCode'),
    role: formData.get('role'),
  });

  if (!parsed.success) {
    redirect('/super-admin/users?error=invalid');
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    redirect('/super-admin/users?error=invite_failed');
  }

  // The only place in src/ that constructs a service-role client, and the
  // only thing it's used for: creating a new auth user (mirrors the exact
  // pattern scripts/seed-users.ts already uses successfully). Never
  // exported, never imported elsewhere, never used for an auth decision.
  const serviceClient = createClient(url, serviceKey);

  const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
    parsed.data.email,
    {
      data: { full_name: parsed.data.fullName, user_code: parsed.data.userCode },
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    }
  );

  if (inviteError || !invited.user) {
    redirect('/super-admin/users?error=invite_failed');
  }

  if (parsed.data.role !== 'user') {
    const { error: roleError } = await serviceClient
      .from('profiles')
      .update({ role: parsed.data.role })
      .eq('id', invited.user.id);
    if (roleError) {
      redirect('/super-admin/users?error=role_failed');
    }
  }

  // Deliberately the ordinary cookie-based client, not serviceClient — a
  // service_role JWT has no auth.uid(), so log_audit_event would record a
  // null actor if called through it. The inviting super_admin's own
  // session must be used to capture who actually did this.
  const auditClient = await createServerSupabaseClient();
  await logAuditEvent(auditClient, {
    action: 'user_created',
    entityType: 'profile',
    entityId: invited.user.id,
    newState: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      userCode: parsed.data.userCode,
      role: parsed.data.role,
    },
  });

  redirect('/super-admin/users?invited=1');
}
