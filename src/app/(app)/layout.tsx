import Link from 'next/link';
import type { ReactNode } from 'react';
import { getSessionProfile } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
      <div className="flex items-center justify-end border-b border-gray-200 px-4 py-2">
        <Link
          href="/notifications"
          className="relative text-2xl"
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        >
          🔔
          {unreadCount > 0 && (
            <span className="absolute -right-2 -top-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">
              {unreadCount}
            </span>
          )}
        </Link>
      </div>
      {children}
    </>
  );
}
