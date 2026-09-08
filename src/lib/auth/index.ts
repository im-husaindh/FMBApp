import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export type Role = 'user' | 'admin' | 'super_admin';

export interface SessionProfile {
  id: string;
  fullName: string;
  role: Role;
  active: boolean;
}

export async function getSessionProfile(): Promise<SessionProfile | null> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.active) {
    await supabase.auth.signOut();
    return null;
  }

  return {
    id: profile.id,
    fullName: profile.full_name,
    role: profile.role as Role,
    active: profile.active,
  };
}

export async function requireRole(allowed: Role[]): Promise<SessionProfile> {
  const profile = await getSessionProfile();
  if (!profile) redirect('/login');
  if (!allowed.includes(profile.role)) redirect('/not-authorized');
  return profile;
}
