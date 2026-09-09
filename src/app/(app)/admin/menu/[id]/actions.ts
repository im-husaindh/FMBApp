'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { menuVersionCreateSchema } from '@/lib/validation/menu';

export async function updateMenuVersionAction(formData: FormData) {
  await requireRole(['admin', 'super_admin']);

  const versionId = formData.get('versionId') as string;
  const menuId = formData.get('menuId') as string;
  const itemsRaw = formData.get('items');

  const parsed = menuVersionCreateSchema.pick({ title: true, notes: true, items: true }).safeParse({
    title: formData.get('title'),
    notes: formData.get('notes') ?? '',
    items: itemsRaw ? JSON.parse(itemsRaw as string) : [],
  });

  if (!parsed.success) {
    redirect(`/admin/menu/${menuId}?error=invalid`);
  }

  const supabase = await createServerSupabaseClient();

  const { error: updateError } = await supabase
    .from('menu_versions')
    .update({ title: parsed.data.title || null, notes: parsed.data.notes || null })
    .eq('id', versionId);

  if (updateError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  const { error: deleteError } = await supabase.from('menu_items').delete().eq('menu_version_id', versionId);
  if (deleteError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  const itemRows = parsed.data.items.map((item, index) => ({
    menu_version_id: versionId,
    item_name: item.itemName,
    category: item.category,
    description: item.description || null,
    display_order: item.displayOrder ?? index,
  }));
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}

export async function submitForApprovalAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const versionId = formData.get('versionId') as string;
  const menuId = formData.get('menuId') as string;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('menu_versions')
    .update({
      status: 'pending_approval',
      submitted_by: profile.id,
      submitted_at: new Date().toISOString(),
    })
    .eq('id', versionId)
    .in('status', ['draft', 'rejected']);

  if (error) {
    redirect(`/admin/menu/${menuId}?error=submit_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}

export async function createNewVersionAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const menuId = formData.get('menuId') as string;

  const supabase = await createServerSupabaseClient();
  const { data: existingVersions } = await supabase
    .from('menu_versions')
    .select('version_number')
    .eq('menu_id', menuId)
    .order('version_number', { ascending: false })
    .limit(1);
  const nextVersionNumber = (existingVersions?.[0]?.version_number ?? 0) + 1;

  const { error } = await supabase.from('menu_versions').insert({
    menu_id: menuId,
    version_number: nextVersionNumber,
    status: 'draft',
    created_by: profile.id,
  });

  if (error) {
    redirect(`/admin/menu/${menuId}?error=already_active`);
  }

  redirect(`/admin/menu/${menuId}`);
}
