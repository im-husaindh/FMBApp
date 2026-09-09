'use server';

import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { menuVersionCreateSchema } from '@/lib/validation/menu';

export async function createMenuAction(formData: FormData) {
  const profile = await requireRole(['admin', 'super_admin']);

  const itemsRaw = formData.get('items');
  const parsed = menuVersionCreateSchema.safeParse({
    serviceDate: formData.get('serviceDate'),
    title: formData.get('title'),
    notes: formData.get('notes'),
    items: itemsRaw ? JSON.parse(itemsRaw as string) : [],
  });

  if (!parsed.success) {
    redirect('/admin/menu/new?error=invalid');
  }

  const supabase = await createServerSupabaseClient();

  let menuId: string;
  const { data: existingMenu } = await supabase
    .from('menus')
    .select('id')
    .eq('service_date', parsed.data.serviceDate)
    .single();

  if (existingMenu) {
    menuId = existingMenu.id;
  } else {
    const { data: newMenu, error: menuError } = await supabase
      .from('menus')
      .insert({ service_date: parsed.data.serviceDate })
      .select('id')
      .single();
    if (menuError || !newMenu) {
      redirect('/admin/menu/new?error=save_failed');
    }
    menuId = newMenu!.id;
  }

  const { data: existingVersions } = await supabase
    .from('menu_versions')
    .select('version_number')
    .eq('menu_id', menuId)
    .order('version_number', { ascending: false })
    .limit(1);
  const nextVersionNumber = (existingVersions?.[0]?.version_number ?? 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menuId,
      version_number: nextVersionNumber,
      title: parsed.data.title || null,
      notes: parsed.data.notes || null,
      status: 'draft',
      created_by: profile.id,
    })
    .select('id')
    .single();

  if (versionError) {
    if (versionError.code === '23505') {
      redirect(`/admin/menu?error=already_active`);
    }
    redirect('/admin/menu/new?error=save_failed');
  }
  if (!version) {
    redirect('/admin/menu/new?error=save_failed');
  }

  const itemRows = parsed.data.items.map((item, index) => ({
    menu_version_id: version!.id,
    item_name: item.itemName,
    category: item.category,
    description: item.description || null,
    display_order: item.displayOrder ?? index,
  }));

  const { error: itemsError } = await supabase.from('menu_items').insert(itemRows);
  if (itemsError) {
    redirect(`/admin/menu/${menuId}?error=items_save_failed`);
  }

  redirect(`/admin/menu/${menuId}`);
}
