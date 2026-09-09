import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (local Supabase only — never run this against a production project).'
  );
}

const supabase = createClient(url, serviceKey);

function dateOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function seed() {
  const { data: admin } = await supabase.from('profiles').select('id').eq('user_code', 'AD001').single();
  const { data: superAdmin } = await supabase.from('profiles').select('id').eq('user_code', 'SA001').single();
  const { data: users } = await supabase
    .from('profiles')
    .select('id, user_code')
    .in('user_code', ['US004', 'US005', 'US006']);

  if (!admin || !superAdmin || !users || users.length < 3) {
    throw new Error('Run `npm run seed:users` first — admin/super_admin/US004-US006 profiles not found.');
  }

  const leaveRows = [
    {
      user_id: users.find((u) => u.user_code === 'US004')!.id,
      from_date: dateOffset(2),
      to_date: dateOffset(4),
      reason: 'Family function',
      entered_by: admin.id,
    },
    {
      user_id: users.find((u) => u.user_code === 'US005')!.id,
      from_date: dateOffset(-2),
      to_date: dateOffset(1),
      reason: 'Travel',
      entered_by: admin.id,
    },
    {
      user_id: users.find((u) => u.user_code === 'US006')!.id,
      from_date: dateOffset(6),
      to_date: dateOffset(9),
      reason: null,
      entered_by: admin.id,
    },
  ];

  for (const row of leaveRows) {
    const { error } = await supabase.from('user_leaves').insert(row);
    if (error) {
      console.error(`Failed to seed leave for ${row.user_id}:`, error.message);
      continue;
    }
    console.log(`Seeded leave: ${row.from_date} to ${row.to_date}`);
  }

  const holidayDate = dateOffset(5);
  const { error: holidayError } = await supabase
    .from('service_holidays')
    .insert({ service_date: holidayDate, reason: 'Community Event', created_by: superAdmin.id });
  if (holidayError) {
    console.error('Failed to seed service holiday:', holidayError.message);
  } else {
    console.log(`Seeded service holiday for ${holidayDate}`);
  }
}

seed();
