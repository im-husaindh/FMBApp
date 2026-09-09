import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { computeMenuDiff } from '@/lib/menu/diff';
import { approveAction, rejectAction } from './actions';

type PendingVersionRow = {
  id: string;
  menus: { service_date: string; current_approved_version_id: string | null } | null;
  menu_items: { item_name: string; category: string; description: string | null; display_order: number }[];
};

export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['super_admin']);
  const { error: actionError } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const { data: pendingVersions, error } = await supabase
    .from('menu_versions')
    .select(
      'id, menu_id, title, submitted_at, menus!menu_versions_menu_id_fkey(service_date, current_approved_version_id), menu_items(item_name, category, description, display_order)'
    )
    .eq('status', 'pending_approval')
    .order('submitted_at', { ascending: true })
    .overrideTypes<Array<PendingVersionRow>, { merge: false }>();

  if (error) {
    console.error('Error fetching pending versions:', error);
  }

  const rows = await Promise.all(
    (pendingVersions ?? []).map(async (version) => {
      let oldItems: { item_name: string; category: string; description: string | null; display_order: number }[] =
        [];
      const approvedVersionId = version.menus?.current_approved_version_id;
      if (approvedVersionId) {
        const { data: approved } = await supabase
          .from('menu_items')
          .select('item_name, category, description, display_order')
          .eq('menu_version_id', approvedVersionId);
        oldItems = approved ?? [];
      }
      const diff = computeMenuDiff(
        oldItems.map((i) => ({
          itemName: i.item_name,
          category: i.category,
          description: i.description,
          displayOrder: i.display_order,
        })),
        version.menu_items.map((i) => ({
          itemName: i.item_name,
          category: i.category,
          description: i.description,
          displayOrder: i.display_order,
        }))
      );
      return { version, diff };
    })
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-bold">Menu Approvals</h1>
      {actionError && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          This menu could not be updated. It may have already been reviewed — refresh and try again.
        </p>
      )}
      {rows.length === 0 && <p className="mt-4 text-lg text-gray-600">No pending menu approvals.</p>}
      <div className="mt-6 space-y-6">
        {rows.map(({ version, diff }) => (
          <div key={version.id} className="rounded-lg border border-gray-200 p-4">
            <p className="text-xl font-semibold">{version.menus?.service_date}</p>
            {diff.map((d) => (
              <div key={d.category} className="mt-2">
                {d.changed.map((c, i) => (
                  <p key={i} className="text-lg">
                    <span className="capitalize">{d.category}</span>: {c.old.itemName} → {c.new.itemName}
                  </p>
                ))}
                {d.added.map((a, i) => (
                  <p key={i} className="text-lg text-green-700">
                    + {a.itemName} ({d.category})
                  </p>
                ))}
                {d.removed.map((r, i) => (
                  <p key={i} className="text-lg text-red-700">
                    - {r.itemName} ({d.category})
                  </p>
                ))}
              </div>
            ))}
            <div className="mt-4 flex flex-wrap gap-3">
              <form action={approveAction}>
                <input type="hidden" name="versionId" value={version.id} />
                <button type="submit" className="h-14 rounded-lg bg-green-600 px-6 text-xl font-semibold text-white">
                  Approve
                </button>
              </form>
              <form action={rejectAction} className="flex flex-1 items-end gap-3">
                <input type="hidden" name="versionId" value={version.id} />
                <input
                  name="reason"
                  placeholder="Rejection reason"
                  required
                  className="h-14 flex-1 rounded-lg border border-gray-300 px-4 text-lg"
                />
                <button type="submit" className="h-14 rounded-lg bg-red-600 px-6 text-xl font-semibold text-white">
                  Reject
                </button>
              </form>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
