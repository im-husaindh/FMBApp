import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import { isBeforeCutoff, todayInTimezone } from '@/lib/time/cutoff';
import { submitMultiDayRequestsAction } from './actions';
import { MultiDaySelector, type DayData } from '@/components/thali/multi-day-selector';

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
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '23:30';
  const cutoffTimeDisplay = new Date(`1970-01-01T${cutoffTime}`).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';
  const rotiMin = (settings[SETTINGS_KEYS.ROTI_MIN_QTY] as number) ?? 0;
  const rotiMax = (settings[SETTINGS_KEYS.ROTI_MAX_QTY] as number) ?? 6;

  const today = todayInTimezone(timezone);

  // All approved menus from today onwards
  const { data: menus } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .not('current_approved_version_id', 'is', null)
    .gte('service_date', today)
    .order('service_date', { ascending: true });

  const approvedMenus = menus ?? [];
  const serviceDates = approvedMenus.map((m) => m.service_date);

  // Menu items for each approved version
  const approvedVersionIds = approvedMenus
    .map((m) => m.current_approved_version_id)
    .filter((id): id is string => !!id);

  const { data: versions } = approvedVersionIds.length
    ? await supabase
        .from('menu_versions')
        .select('id, menu_items(item_name, display_order)')
        .in('id', approvedVersionIds)
    : {
        data: [] as {
          id: string;
          menu_items: { item_name: string; display_order: number }[];
        }[],
      };

  const versionsById = new Map((versions ?? []).map((v) => [v.id, v]));

  // Existing thali requests for these dates
  const { data: existingRequests } = serviceDates.length
    ? await supabase
        .from('thali_requests')
        .select('service_date, wants_thali, gravy_portion_id, rice_portion_id, roti_quantity')
        .eq('user_id', profile.id)
        .in('service_date', serviceDates)
    : {
        data: [] as {
          service_date: string;
          wants_thali: boolean;
          gravy_portion_id: string | null;
          rice_portion_id: string | null;
          roti_quantity: number | null;
        }[],
      };

  const requestsByDate = new Map(
    (existingRequests ?? []).map((r) => [r.service_date, r])
  );

  // Leave and holiday rows for these dates
  const [{ data: leaveRows }, { data: holidayRows }] = serviceDates.length
    ? await Promise.all([
        supabase
          .from('user_leaves')
          .select('from_date, to_date, reason')
          .eq('user_id', profile.id)
          .lte('from_date', serviceDates[serviceDates.length - 1])
          .gte('to_date', serviceDates[0]),
        supabase
          .from('service_holidays')
          .select('service_date, reason')
          .in('service_date', serviceDates),
      ])
    : [
        { data: [] as { from_date: string; to_date: string; reason: string | null }[] },
        { data: [] as { service_date: string; reason: string | null }[] },
      ];

  const holidayReasonByDate = new Map(
    (holidayRows ?? []).map((h) => [h.service_date, h.reason])
  );

  function leaveReasonFor(serviceDate: string): string | null {
    for (const leave of leaveRows ?? []) {
      if (leave.from_date <= serviceDate && serviceDate <= leave.to_date) {
        return leave.reason ?? 'On leave';
      }
    }
    return null;
  }

  // Portion options
  const [{ data: gravyOptions }, { data: riceOptions }] = await Promise.all([
    supabase
      .from('portion_options')
      .select('id, label')
      .eq('category', 'gravy')
      .eq('active', true)
      .order('sort_order'),
    supabase
      .from('portion_options')
      .select('id, label')
      .eq('category', 'rice')
      .eq('active', true)
      .order('sort_order'),
  ]);

  // Build DayData array
  const days: DayData[] = approvedMenus.map((menu) => {
    const version = menu.current_approved_version_id
      ? versionsById.get(menu.current_approved_version_id)
      : undefined;
    const menuItems = (version?.menu_items ?? [])
      .sort((a, b) => a.display_order - b.display_order)
      .map((i) => i.item_name);

    const locked = !isBeforeCutoff(menu.service_date, timezone, cutoffTime);
    const leaveReason = leaveReasonFor(menu.service_date);
    const holidayReason = holidayReasonByDate.get(menu.service_date) ?? null;
    const unavailable = leaveReason !== null || holidayReason !== null;
    const unavailableReason =
      leaveReason ?? (holidayReason ? `No service: ${holidayReason}` : null);

    const req = requestsByDate.get(menu.service_date) ?? null;
    const existing = req
      ? {
          wantsThali: req.wants_thali,
          gravyPortionId: req.gravy_portion_id,
          ricePortionId: req.rice_portion_id,
          rotiQuantity: req.roti_quantity,
        }
      : null;

    return { serviceDate: menu.service_date, menuItems, locked, unavailable, unavailableReason, existing };
  });

  const errorMessage =
    errorParam === 'cutoff_passed'
      ? 'One or more selections could not be saved — the cutoff has passed.'
      : errorParam === 'invalid'
        ? 'Your selection was not saved. Please try again.'
        : errorParam === 'unavailable'
          ? 'One or more dates are unavailable (leave or no-service day).'
          : null;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">Good Morning, {profile.fullName}</h1>

      {errorMessage && (
        <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-lg text-red-700">
          {errorMessage}
        </p>
      )}

      <h2 className="mt-6 text-2xl font-bold">Upcoming Thali Requests</h2>
      <p className="text-sm text-gray-600">
        Cutoff: {cutoffTimeDisplay}, two days before each service date.
      </p>

      <MultiDaySelector
        days={days}
        gravyOptions={gravyOptions ?? []}
        riceOptions={riceOptions ?? []}
        rotiMin={rotiMin}
        rotiMax={rotiMax}
        cutoffTime={cutoffTimeDisplay}
        action={submitMultiDayRequestsAction}
      />
    </main>
  );
}
