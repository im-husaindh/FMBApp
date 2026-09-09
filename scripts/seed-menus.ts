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
}

async function createPendingMenu(serviceDate: string, adminId: string) {
  const { data: menu } = await supabase.from('menus').insert({ service_date: serviceDate }).select('id').single();
  if (!menu) return;

  const { data: version } = await supabase
    .from('menu_versions')
    .insert({
      menu_id: menu.id,
      version_number: 1,
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
      await createPendingMenu(serviceDate, admin.id);
    } else if (offset === 5) {
      await createRejectedMenu(serviceDate, admin.id, superAdmin.id);
    } else {
      await createApprovedMenu(serviceDate, admin.id, superAdmin.id);
    }
    console.log(`Seeded menu for ${serviceDate}`);
  }
}

seed();
