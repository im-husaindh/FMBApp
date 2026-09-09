import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff, todayInTimezone, serviceDateRange } from '@/lib/time/cutoff';
import { submitThaliRequestAction, logoutAction } from './actions';
import { ThaliRequestCard, type ExistingRequest } from '@/components/thali/thali-request-card';
import { MenuCalendar, type CalendarDay } from '@/components/thali/menu-calendar';

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const profile = await requireRole(['user', 'admin', 'super_admin']);
  const { error: errorParam } = await searchParams;
  const supabase = await createServerSupabaseClient();

  const settings = await getSettings(supabase, [
    SETTINGS_KEYS.CUTOFF_TIME,
    SETTINGS_KEYS.TIMEZONE,
    SETTINGS_KEYS.ROTI_MIN_QTY,
    SETTINGS_KEYS.ROTI_MAX_QTY,
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '18:00';
  const cutoffTimeDisplay = new Date(`1970-01-01T${cutoffTime}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const today = todayInTimezone(timezone);
  const tomorrow = addDays(today, 1);
  const cutoffPassed = !isBeforeCutoff(tomorrow, timezone, cutoffTime);

  const dates = serviceDateRange(timezone, 3, 7);

  const { data: menus } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .in('service_date', dates);

  const approvedVersionIds = (menus ?? [])
    .map((m) => m.current_approved_version_id)
    .filter((id): id is string => !!id);

  const { data: versions } = approvedVersionIds.length
    ? await supabase.from('menu_versions').select('id, menu_items(item_name, display_order)').in('id', approvedVersionIds)
    : { data: [] as { id: string; menu_items: { item_name: string; display_order: number }[] }[] };

  const versionsById = new Map((versions ?? []).map((v) => [v.id, v]));
  const calendarDays: CalendarDay[] = dates.map((serviceDate) => {
    const menu = (menus ?? []).find((m) => m.service_date === serviceDate);
    const version = menu?.current_approved_version_id ? versionsById.get(menu.current_approved_version_id) : undefined;
    const items = (version?.menu_items ?? []).sort((a, b) => a.display_order - b.display_order).map((i) => i.item_name);
    return { serviceDate, items };
  });

  const tomorrowMenu = calendarDays.find((d) => d.serviceDate === tomorrow);

  const { data: gravyOptions } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'gravy')
    .eq('active', true)
    .order('sort_order');
  const { data: riceOptions } = await supabase
    .from('portion_options')
    .select('id, label')
    .eq('category', 'rice')
    .eq('active', true)
    .order('sort_order');

  const { data: existing, error: existingError } = await supabase
    .from('thali_requests')
    .select('wants_thali, gravy_portion_id, rice_portion_id, roti_quantity, updated_at')
    .eq('service_date', tomorrow)
    .eq('user_id', profile.id)
    .maybeSingle();

  if (existingError) {
    console.error('Failed to load existing thali request:', existingError);
  }

  let existingRequest: ExistingRequest = null;
  if (existing) {
    existingRequest = {
      wantsThali: existing.wants_thali,
      rotiQuantity: existing.roti_quantity,
      gravyPortionId: existing.gravy_portion_id,
      ricePortionId: existing.rice_portion_id,
      gravyLabel: (gravyOptions ?? []).find((o) => o.id === existing.gravy_portion_id)?.label ?? null,
      riceLabel: (riceOptions ?? []).find((o) => o.id === existing.rice_portion_id)?.label ?? null,
      updatedAt: existing.updated_at,
    };
  }

  const errorMessage =
    errorParam === 'cutoff_passed'
      ? 'Selection time has closed. Your previous saved selection has been kept.'
      : errorParam === 'invalid'
        ? 'Your selection was not saved. Please try again.'
        : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Good Morning, {profile.fullName}</h1>
        <form action={logoutAction}>
          <button type="submit" className="text-lg text-blue-600 underline">
            Log Out
          </button>
        </form>
      </div>

      {errorMessage && (
        <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">{errorMessage}</p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Tomorrow&apos;s Thali</h2>
      <p className="text-lg text-gray-600">{tomorrow}</p>
      {tomorrowMenu && tomorrowMenu.items.length > 0 ? (
        <div className="mt-2 space-y-1 text-lg">
          {tomorrowMenu.items.map((item) => (
            <p key={item}>{item}</p>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-lg text-gray-600">No menu has been published for this date yet.</p>
      )}

      <div className="mt-4">
        <ThaliRequestCard
          key={existingRequest?.updatedAt ?? 'none'}
          serviceDate={tomorrow}
          serviceDateLabel="tomorrow"
          cutoffPassed={cutoffPassed}
          existingRequest={existingRequest}
          gravyOptions={gravyOptions ?? []}
          riceOptions={riceOptions ?? []}
          rotiMin={rotiMin}
          rotiMax={rotiMax}
          cutoffTime={cutoffTimeDisplay}
          action={submitThaliRequestAction}
        />
      </div>

      <MenuCalendar days={calendarDays} todayDate={today} tomorrowDate={tomorrow} />
    </main>
  );
}
