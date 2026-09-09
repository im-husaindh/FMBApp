import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (local Supabase only — never run this against a production project).'
  );
}

const supabase = createClient(url, serviceKey);

const MENU_TEMPLATE = [
  { itemName: 'Dal Fry', category: 'dal', displayOrder: 0 },
  { itemName: 'Paneer Masala', category: 'gravy', displayOrder: 1 },
  { itemName: 'Jeera Rice', category: 'rice', displayOrder: 2 },
  { itemName: 'Roti', category: 'roti', displayOrder: 3 },
  { itemName: 'Salad', category: 'salad', displayOrder: 4 },
];

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createApprovedMenu(serviceDate: string, adminId: string, superAdminId: string) {
  const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
  if (!menu) return;

  const now = new Date().toISOString();
  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menu.id,
      version_number: 1,
      status: 'approved',
      created_by: adminId,
      submitted_by: adminId,
      submitted_at: now,
      approved_by: superAdminId,
      approved_at: now,
    })
    .select('id')
    .single();
  if (!version) return;

  await supabase.from('menu_items').insert(
    MENU_TEMPLATE.map((item) => ({
      menu_version_id: version.id,
      item_name: item.itemName,
      category: item.category,
      display_order: item.displayOrder,
    }))
  );

  await supabase.from('menus').update({ current_approved_version_id: version.id }).eq('id', menu.id);
  return menu.id;
}

// If `existingMenuId` is given, adds a pending version on top of that menu's existing
// versions (e.g. a v2 pending review while v1 is still the approved/live version) instead
// of creating a brand-new menu. This is what exercises the "supersede the old approved
// version" branch of the approve_menu_version RPC.
async function createPendingMenu(serviceDate: string, adminId: string, existingMenuId?: string) {
  let menuId: string;
  let nextVersionNumber = 1;

  if (existingMenuId) {
    menuId = existingMenuId;
    const { data: latestVersion } = await supabase
      .from('menu_versions')
      .select('version_number')
      .eq('menu_id', menuId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();
    nextVersionNumber = (latestVersion?.version_number ?? 0) + 1;
  } else {
    const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
    if (!menu) return;
    menuId = menu.id;
  }

  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menuId,
      version_number: nextVersionNumber,
      status: 'pending_approval',
      created_by: adminId,
      submitted_by: adminId,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (!version) return;

  await supabase.from('menu_items').insert(
    MENU_TEMPLATE.slice(0, 3).map((item) => ({
      menu_version_id: version.id,
      item_name: item.itemName,
      category: item.category,
      display_order: item.displayOrder,
    }))
  );
}

async function createRejectedMenu(serviceDate: string, adminId: string, superAdminId: string) {
  const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
  if (!menu) return;

  const now = new Date().toISOString();
  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menu.id,
      version_number: 1,
      status: 'rejected',
      created_by: adminId,
      submitted_by: adminId,
      submitted_at: now,
      rejected_by: superAdminId,
      rejected_at: now,
      rejection_reason: 'Please add a sweet item and reduce spice level for Paneer Masala.',
    })
    .select('id')
    .single();
  if (!version) return;

  await supabase.from('menu_items').insert(
    MENU_TEMPLATE.map((item) => ({
      menu_version_id: version.id,
      item_name: item.itemName,
      category: item.category,
      display_order: item.displayOrder,
    }))
  );
}

async function seed() {
  const { data: admin } = await supabase.from('profiles').select('id').eq('user_code', 'AD001').single();
  const { data: superAdmin } = await supabase.from('profiles').select('id').eq('user_code', 'SA001').single();

  if (!admin || !superAdmin) {
    throw new Error('Run `npm run seed:users` first — admin/super_admin profiles not found.');
  }

  for (let offset = -3; offset <= 7; offset++) {
    const serviceDate = dateOffset(offset);
    if (offset === 4) {
      // Approved v1, then a separate pending v2 on top of it — exercises the RPC's
      // "old approved version becomes superseded" branch when v2 is approved.
      const menuId = await createApprovedMenu(serviceDate, admin.id, superAdmin.id);
      if (menuId) await createPendingMenu(serviceDate, admin.id, menuId);
    } else if (offset === 5) {
      await createRejectedMenu(serviceDate, admin.id, superAdmin.id);
    } else if (offset === 6) {
      // Independent pending-only menu, with no approved version — a separate pending
      // scenario so tests that reject a pending version don't fight over the same row
      // the "approve" test consumes.
      await createPendingMenu(serviceDate, admin.id);
    } else {
      await createApprovedMenu(serviceDate, admin.id, superAdmin.id);
    }
    console.log(`Seeded menu for ${serviceDate}`);
  }
}

seed();
