import { BackButton } from '@/components/ui/back-button';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { EditMenuForm } from './edit-menu-form';
import { submitForApprovalAction, createNewVersionAction } from './actions';

export default async function AdminMenuDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { id } = await params;
  const { error } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: menu } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .eq('id', id)
    .single();

  const { data: versions } = await supabase
    .from('menu_versions')
    .select(
      'id, version_number, title, notes, status, rejection_reason, menu_items(id, item_name, category, description, display_order)'
    )
    .eq('menu_id', id)
    .order('version_number', { ascending: false });

  const activeVersion = versions?.find((v) => ['draft', 'pending_approval', 'rejected'].includes(v.status));
  const approvedVersion = versions?.find((v) => v.id === menu?.current_approved_version_id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <BackButton />
      <h1 className="text-3xl font-bold">{menu?.service_date}</h1>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Something went wrong saving your changes. Please try again.
        </p>
      )}

      {activeVersion && activeVersion.status !== 'pending_approval' && (
        <>
          {activeVersion.status === 'rejected' && (
            <p className="mt-4 rounded-lg bg-yellow-50 px-4 py-3 text-lg text-yellow-800">
              Rejected: {activeVersion.rejection_reason}
            </p>
          )}
          <EditMenuForm
            menuId={id}
            versionId={activeVersion.id}
            title={activeVersion.title ?? ''}
            items={activeVersion.menu_items}
          />
          <form action={submitForApprovalAction} className="mt-4">
            <input type="hidden" name="menuId" value={id} />
            <input type="hidden" name="versionId" value={activeVersion.id} />
            <button type="submit" className="h-14 w-full rounded-lg bg-green-600 text-xl font-semibold text-white">
              Submit for Approval
            </button>
          </form>
        </>
      )}

      {activeVersion?.status === 'pending_approval' && (
        <p className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-lg text-blue-800">
          Awaiting super admin review.
        </p>
      )}

      {!activeVersion && approvedVersion && (
        <>
          <div className="mt-4 rounded-lg border border-gray-200 p-4">
            <p className="text-lg font-semibold">Current approved menu</p>
            <ul className="mt-2 space-y-1 text-lg">
              {[...approvedVersion.menu_items]
                .sort((a, b) => a.display_order - b.display_order)
                .map((item) => (
                  <li key={item.id}>
                    {item.item_name} ({item.category})
                  </li>
                ))}
            </ul>
          </div>
          <form action={createNewVersionAction} className="mt-4">
            <input type="hidden" name="menuId" value={id} />
            <button type="submit" className="h-14 w-full rounded-lg bg-blue-600 text-xl font-semibold text-white">
              Edit This Menu
            </button>
          </form>
        </>
      )}

      {!activeVersion && !approvedVersion && <p className="mt-4 text-lg text-gray-600">No menu content yet.</p>}
    </main>
  );
}
