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
  const { data: users } = await supabase
    .from('profiles')
    .select('id, user_code')
    .in('user_code', ['US001', 'US002', 'US003']);

  if (!admin || !users || users.length < 3) {
    throw new Error('Run `npm run seed:users` first — admin/US001-US003 profiles not found.');
  }

  const byCode = (code: string) => users.find((u) => u.user_code === code)!.id;

  const concernRows: {
    user_id: string;
    concern_date: string;
    category: string;
    message: string;
    status: string;
    resolved_at: string | null;
  }[] = [
    {
      user_id: byCode('US001'),
      concern_date: dateOffset(-1),
      category: 'taste',
      message: 'The gravy was too salty yesterday.',
      status: 'open',
      resolved_at: null,
    },
    {
      user_id: byCode('US002'),
      concern_date: dateOffset(-2),
      category: 'quantity',
      message: 'The roti portion felt smaller than usual.',
      status: 'reviewing',
      resolved_at: null,
    },
    {
      user_id: byCode('US003'),
      concern_date: dateOffset(-3),
      category: 'packaging',
      message: 'The container lid was not sealing properly.',
      status: 'resolved',
      resolved_at: new Date().toISOString(),
    },
  ];

  for (const row of concernRows) {
    const { data: concern, error } = await supabase.from('concerns').insert(row).select('id, user_id, status').single();
    if (error || !concern) {
      console.error(`Failed to seed concern for ${row.user_id}:`, error?.message);
      continue;
    }
    console.log(`Seeded concern (${row.status}) for ${row.user_id}`);

    if (concern.status === 'reviewing' || concern.status === 'resolved') {
      const { error: updateError } = await supabase.from('concern_updates').insert({
        concern_id: concern.id,
        new_status: concern.status,
        message: concern.status === 'resolved' ? 'We have addressed this for tomorrow.' : 'Looking into this.',
        changed_by: admin!.id,
      });
      if (updateError) console.error('Failed to seed concern_update:', updateError.message);
    }

    if (concern.status === 'resolved') {
      const { error: notifyError } = await supabase.from('notifications').insert({
        recipient_id: concern.user_id,
        type: 'concern_resolved',
        payload: { concernId: concern.id },
      });
      if (notifyError) console.error('Failed to seed notification:', notifyError.message);
    }
  }
}

seed();
