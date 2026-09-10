'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { menuVersionCreateSchema } from '@/lib/validation/menu';
import { logAuditEvent } from '@/lib/audit';

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

  const { data: previousVersion } = await supabase
    .from('menu_versions')
    .select('title, notes')
    .eq('id', versionId)
    .maybeSingle();

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
    display_order: index,
  }));
  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=save_failed`);
  }

  await logAuditEvent(supabase, {
    action: 'menu_edited',
    entityType: 'menu_version',
    entityId: versionId,
    previousState: previousVersion ? { title: previousVersion.title, notes: previousVersion.notes } : null,
    newState: { title: parsed.data.title || null, notes: parsed.data.notes || null },
  });

  redirect(`/admin/menu/${menuId}`);
}

export async function submitForApprovalAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);
  const versionId = formData.get('versionId') as string;
  const menuId = formData.get('menuId') as string;

  const supabase = await createServerSupabaseClient();

  const { data: existingItems, error: itemsCheckError } = await supabase
    .from('menu_items')
    .select('id')
    .eq('menu_version_id', versionId)
    .limit(1);

  if (itemsCheckError) {
    redirect(`/admin/menu/${menuId}?error=submit_failed`);
  }

  if (!existingItems || existingItems.length === 0) {
    redirect(`/admin/menu/${menuId}?error=no_items`);
  }

  const { data: previousVersion } = await supabase
    .from('menu_versions')
    .select('status')
    .eq('id', versionId)
    .maybeSingle();

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

  await logAuditEvent(supabase, {
    action: 'menu_submitted',
    entityType: 'menu_version',
    entityId: versionId,
    previousState: { status: previousVersion?.status ?? null },
    newState: { status: 'pending_approval' },
  });

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

  const { data: menu, error: menuError } = await supabase
    .from('menus')
    .select('current_approved_version_id')
    .eq('id', menuId)
    .single();

  if (menuError) {
    redirect(`/admin/menu/${menuId}?error=already_active`);
  }

  const { data: newVersion, error } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menuId,
      version_number: nextVersionNumber,
      status: 'draft',
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (error || !newVersion) {
    redirect(`/admin/menu/${menuId}?error=already_active`);
  }

  if (menu?.current_approved_version_id) {
    const { data: approvedItems, error: approvedItemsError } = await supabase
      .from('menu_items')
      .select('item_name, category, description, display_order')
      .eq('menu_version_id', menu.current_approved_version_id);

    if (approvedItemsError) {
      redirect(`/admin/menu/${menuId}?error=already_active`);
    }

    if (approvedItems && approvedItems.length > 0) {
      const itemRows = approvedItems.map((item) => ({
        menu_version_id: newVersion!.id,
        item_name: item.item_name,
        category: item.category,
        description: item.description,
        display_order: item.display_order,
      }));
      const { error: copyItemsError } = await supabase.from('menu_items').insert(itemRows);
      if (copyItemsError) {
        redirect(`/admin/menu/${menuId}?error=already_active`);
      }
    }
  }

  await logAuditEvent(supabase, {
    action: 'menu_edited',
    entityType: 'menu_version',
    entityId: newVersion!.id,
    newState: {
      copiedFromVersionId: menu?.current_approved_version_id ?? null,
    },
  });

  redirect(`/admin/menu/${menuId}`);
}
