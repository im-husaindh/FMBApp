'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

type Role = 'user' | 'admin' | 'super_admin';

interface Tab {
  label: string;
  icon: string;
  href: string;
  roles: Role[];
}

const TABS: Tab[] = [
  { label: 'Home',          icon: '🏠', href: '/dashboard',    roles: ['user', 'admin', 'super_admin'] },
  { label: 'Concerns',      icon: '💬', href: '/concerns',     roles: ['user', 'admin', 'super_admin'] },
  { label: 'Notifications', icon: '🔔', href: '/notifications', roles: ['user', 'admin', 'super_admin'] },
  { label: 'Admin',         icon: '⚙️', href: '/admin',        roles: ['admin', 'super_admin'] },
  { label: 'Super Admin',   icon: '🛡️', href: '/super-admin',  roles: ['super_admin'] },
];

interface Props {
  role: Role;
  unreadCount: number;
}

export function BottomTabBar({ role, unreadCount }: Props) {
  const pathname = usePathname();

  const visibleTabs = TABS.filter((t) => t.roles.includes(role));

  return (
    <nav
      role="navigation"
      aria-label="Main navigation"
      className="fixed bottom-0 left-0 right-0 flex border-t border-gray-200 bg-white"
    >
      {visibleTabs.map((tab) => {
        const isActive = pathname === tab.href || pathname.startsWith(tab.href + '/');
        const isNotifications = tab.href === '/notifications';
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-label={
              isNotifications && unreadCount > 0
                ? `${tab.label} (${unreadCount} unread)`
                : tab.label
            }
            aria-current={isActive ? 'page' : undefined}
            className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors ${
              isActive ? 'text-blue-600' : 'text-gray-500'
            }`}
          >
            <span className="text-xl leading-none" aria-hidden="true">
              {tab.icon}
            </span>
            <span>{tab.label}</span>
            {isNotifications && unreadCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute right-[calc(50%-20px)] top-1 rounded-full bg-red-600 px-1.5 text-[10px] font-semibold text-white"
              >
                {unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
