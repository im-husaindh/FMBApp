'use server';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { loginSchema } from '@/lib/validation/auth';

export async function loginAction(formData: FormData) {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    redirect('/login?error=invalid');
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  // Same generic message for wrong password vs unknown user — avoids user enumeration.
  if (error) {
    redirect('/login?error=invalid');
  }

  redirect('/dashboard');
}
