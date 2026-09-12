import type { ReactNode } from 'react';
import { getSessionProfile } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { TopHeader } from '@/components/nav/top-header';
import { BottomTabBar } from '@/components/nav/bottom-tab-bar';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const profile = await getSessionProfile();

  if (!profile) {
    return <>{children}</>;
  }

  const supabase = await createServerSupabaseClient();
  const { data: unreadRows } = await supabase
    .from('notifications')
    .select('id')
    .eq('recipient_id', profile.id)
    .is('read_at', null);
  const unreadCount = unreadRows?.length ?? 0;

  return (
    <>
      <TopHeader />
      <div className="pb-20">{children}</div>
      <BottomTabBar role={profile.role} unreadCount={unreadCount} />
    </>
  );
}
