import { requireRole } from '@/lib/auth';
import { createMenuAction } from './actions';
import { NewMenuForm } from './new-menu-form';

export default async function NewMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireRole(['admin', 'super_admin']);
  const { error } = await searchParams;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">New Menu</h1>
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          Could not save the menu. Check the date and items and try again.
        </p>
      )}
      <NewMenuForm action={createMenuAction} />
    </main>
  );
}
