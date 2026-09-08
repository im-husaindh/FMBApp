import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (local Supabase only — never run this against a production project).'
  );
}

const supabase = createClient(url, serviceKey);

// DEVELOPMENT ONLY. Never reuse this password or these accounts outside local dev.
const DEV_PASSWORD = 'DevPass123!';

type SeedUser = {
  email: string;
  fullName: string;
  role: 'super_admin' | 'admin' | 'user';
  userCode: string;
};

const users: SeedUser[] = [
  { email: 'superadmin@fmb.test', fullName: 'Asha Mehta', role: 'super_admin', userCode: 'SA001' },
  { email: 'admin1@fmb.test', fullName: 'Ravi Shah', role: 'admin', userCode: 'AD001' },
  { email: 'admin2@fmb.test', fullName: 'Neha Doshi', role: 'admin', userCode: 'AD002' },
  ...Array.from({ length: 15 }, (_, i) => ({
    email: `user${i + 1}@fmb.test`,
    fullName: `Community Member ${i + 1}`,
    role: 'user' as const,
    userCode: `US${String(i + 1).padStart(3, '0')}`,
  })),
];

async function seed() {
  for (const u of users) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: u.email,
      password: DEV_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: u.fullName, user_code: u.userCode },
    });
    if (error) {
      console.error(`Failed to create ${u.email}:`, error.message);
      continue;
    }
    if (u.role !== 'user') {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: u.role })
        .eq('id', data.user!.id);
      if (updateError) console.error(`Failed to set role for ${u.email}:`, updateError.message);
    }
    console.log(`Created ${u.role}: ${u.email}`);
  }
  console.log('\nDEVELOPMENT ONLY — all seeded users share password:', DEV_PASSWORD);
}

seed();
