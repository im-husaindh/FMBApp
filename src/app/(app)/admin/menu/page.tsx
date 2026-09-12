import { BackButton } from '@/components/ui/back-button';
import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export default async function AdminMenuListPage() {
  await requireRole(['admin', 'super_admin']);
  const supabase = await createServerSupabaseClient();

  const { data: menus } = await supabase
    .from('menus')
    .select(
      'id, service_date, current_approved_version_id, menu_versions!menu_versions_menu_id_fkey(id, status, version_number)'
    )
    .order('service_date', { ascending: false })
    .limit(30);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackButton />
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Menus</h1>
        <Link href="/admin/menu/new" className="rounded-lg bg-blue-600 px-4 py-3 text-lg text-white">
          + New Menu
        </Link>
      </div>
      <div className="mt-6 space-y-3">
        {(menus ?? []).length === 0 && <p className="text-lg text-gray-600">No menus created yet.</p>}
        {(menus ?? []).map((menu) => {
          const activeVersion = menu.menu_versions?.find((v) =>
            ['draft', 'pending_approval', 'rejected'].includes(v.status)
          );
          const label = activeVersion
            ? activeVersion.status
            : menu.current_approved_version_id
              ? 'approved'
              : 'no menu yet';
          return (
            <Link
              key={menu.id}
              href={`/admin/menu/${menu.id}`}
              className="block rounded-lg border border-gray-200 px-4 py-3 text-lg hover:bg-gray-50"
            >
              <span className="font-semibold">{menu.service_date}</span>
              <span className="ml-3 capitalize text-gray-600">{label}</span>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
