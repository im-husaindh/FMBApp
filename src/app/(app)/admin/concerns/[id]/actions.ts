'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { concernReplySchema } from '@/lib/validation/concern';
import { notify, type NotificationType } from '@/lib/notifications';

export async function replyToConcernAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const concernId = formData.get('concernId') as string;

  const parsed = concernReplySchema.safeParse({
    newStatus: formData.get('newStatus'),
    message: formData.get('message'),
  });

  if (!parsed.success) {
    redirect(`/admin/concerns/${concernId}?error=invalid`);
  }

  const { data: concern, error: concernError } = await supabase
    .from('concerns')
    .select('user_id')
    .eq('id', concernId)
    .maybeSingle();

  if (concernError || !concern) {
    redirect('/admin/concerns?error=not_found');
  }

  const { error: insertError } = await supabase.from('concern_updates').insert({
    concern_id: concernId,
    new_status: parsed.data.newStatus,
    message: parsed.data.message || null,
    changed_by: profile.id,
  });

  if (insertError) {
    redirect(`/admin/concerns/${concernId}?error=save_failed`);
  }

  const { error: updateError } = await supabase
    .from('concerns')
    .update({
      status: parsed.data.newStatus,
      updated_at: new Date().toISOString(),
      ...(parsed.data.newStatus === 'resolved' ? { resolved_at: new Date().toISOString() } : {}),
    })
    .eq('id', concernId);

  if (updateError) {
    redirect(`/admin/concerns/${concernId}?error=save_failed`);
  }

  const notificationType: NotificationType = parsed.data.newStatus === 'resolved' ? 'concern_resolved' : 'concern_response';
  await notify(supabase, concern.user_id, notificationType, { concernId });

  redirect(`/admin/concerns/${concernId}`);
}
