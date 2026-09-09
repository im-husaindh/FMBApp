'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { concernCreateSchema } from '@/lib/validation/concern';

export async function createConcernAction(formData: FormData) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const parsed = concernCreateSchema.safeParse({
    concernDate: formData.get('concernDate'),
    category: formData.get('category'),
    message: formData.get('message'),
  });

  if (!parsed.success) {
    redirect('/concerns?error=invalid');
  }

  const { error } = await supabase.from('concerns').insert({
    user_id: profile.id,
    concern_date: parsed.data.concernDate,
    category: parsed.data.category,
    message: parsed.data.message,
  });

  if (error) {
    redirect('/concerns?error=save_failed');
  }

  redirect('/concerns?submitted=1');
}
