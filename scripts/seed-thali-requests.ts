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
  const { data: users } = await supabase.from('profiles').select('id, user_code').like('user_code', 'US%');
  if (!users || users.length === 0) {
    throw new Error('Run `npm run seed:users` first — no US-coded user profiles found.');
  }

  const { data: gravyOptions } = await supabase.from('portion_options').select('id').eq('category', 'gravy');
  const { data: riceOptions } = await supabase.from('portion_options').select('id').eq('category', 'rice');
  if (!gravyOptions?.length || !riceOptions?.length) {
    throw new Error('portion_options is empty — check supabase/seed.sql ran (Phase 1).');
  }

  for (let offset = -3; offset <= 7; offset++) {
    const serviceDate = dateOffset(offset);
    let count = 0;
    for (let index = 0; index < users.length; index++) {
      const user = users[index];
      // Rotate through 5 buckets per (user, date) so every date has a realistic mix:
      // 3/5 request a thali with varied portions, 1/5 says no thali, 1/5 has no response at all.
      const bucket = (index + offset) % 5;
      if (bucket === 4) continue; // no response — no row for this user/date
      const wantsThali = bucket !== 3;
      const row = {
        user_id: user.id,
        service_date: serviceDate,
        wants_thali: wantsThali,
        gravy_portion_id: wantsThali ? gravyOptions[index % gravyOptions.length].id : null,
        rice_portion_id: wantsThali ? riceOptions[index % riceOptions.length].id : null,
        roti_quantity: wantsThali ? 2 + (index % 3) : null,
      };
      await supabase.from('thali_requests').upsert(row, { onConflict: 'user_id,service_date' });
      count++;
    }
    console.log(`Seeded ${count} thali requests for ${serviceDate}`);
  }
}

seed();
