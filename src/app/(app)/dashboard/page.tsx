import { requireRole } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getSettings, SETTINGS_KEYS } from '@/lib/settings';
import {
  isBeforeCutoff,
  todayInTimezone,
  addDays,
  getBiweeklyPeriods,
  getDatesInRange,
  getDayName,
} from '@/lib/time/cutoff';
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
  ]);
  const cutoffTime = (settings[SETTINGS_KEYS.CUTOFF_TIME] as string) ?? '23:30';
  const timezone = (settings[SETTINGS_KEYS.TIMEZONE] as string) ?? 'Asia/Kolkata';

  const today = todayInTimezone(timezone);
  const windowEnd = addDays(today, 60);

  // All approved menus in the next 60 days
  const { data: menus } = await supabase
    .from('menus')
    .select('id, service_date, current_approved_version_id')
    .not('current_approved_version_id', 'is', null)
    .gte('service_date', today)
    .lte('service_date', windowEnd)
    .order('service_date', { ascending: true });

  const approvedMenus = menus ?? [];
  const approvedMenuDates = approvedMenus.map((m) => m.service_date);

  // Compute biweekly periods from available approved menu dates
  const periods = getBiweeklyPeriods(approvedMenuDates);

  if (periods.length === 0) {
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
        <p className="mt-6 text-gray-600">No upcoming menus have been approved yet.</p>
      </main>
    );
  }

  // All dates across all periods
  const allPeriodDates = periods.flatMap((p) => getDatesInRange(p.start, p.end));
  const firstDate = allPeriodDates[0];
  const lastDate = allPeriodDates[allPeriodDates.length - 1];

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
  const menusMap = new Map(approvedMenus.map((m) => [m.service_date, m]));

  // Existing thali requests for all period dates
  const { data: existingRequests } = await supabase
    .from('thali_requests')
    .select('service_date, wants_thali, item_quantities')
    .eq('user_id', profile.id)
    .in('service_date', allPeriodDates);

  const requestsByDate = new Map(
    (existingRequests ?? []).map((r) => [r.service_date, r]),
  );

  // Leave and holiday rows for the full period range
  const [{ data: leaveRows }, { data: holidayRows }] = await Promise.all([
    supabase
      .from('user_leaves')
      .select('from_date, to_date, reason')
      .eq('user_id', profile.id)
      .lte('from_date', lastDate)
      .gte('to_date', firstDate),
    supabase
      .from('service_holidays')
      .select('service_date, reason')
      .in('service_date', allPeriodDates),
  ]);

  const holidayReasonByDate = new Map(
    (holidayRows ?? []).map((h) => [h.service_date, h.reason]),
  );

  function leaveReasonFor(serviceDate: string): string | null {
    for (const leave of leaveRows ?? []) {
      if (leave.from_date <= serviceDate && serviceDate <= leave.to_date) {
        return leave.reason ?? 'On leave';
      }
    }
    return null;
  }

  // Build DayData[][] — one array of 14 days per period
  const periodDays: DayData[][] = periods.map((period) => {
    const dates = getDatesInRange(period.start, period.end);
    return dates.map((serviceDate) => {
      const menu = menusMap.get(serviceDate);
      const isHoliday = !menu;

      const menuItems = menu?.current_approved_version_id
        ? (versionsById.get(menu.current_approved_version_id)?.menu_items ?? [])
            .sort((a, b) => a.display_order - b.display_order)
            .map((i) => i.item_name)
        : [];

      const locked = !isBeforeCutoff(serviceDate, timezone, cutoffTime);
      const isPast = serviceDate < today;
      const dayName = getDayName(serviceDate);

      const leaveReason = isHoliday ? null : leaveReasonFor(serviceDate);
      const holidayReason = isHoliday ? null : (holidayReasonByDate.get(serviceDate) ?? null);
      const unavailable = !isHoliday && (leaveReason !== null || holidayReason !== null);
      const unavailableReason =
        leaveReason ?? (holidayReason ? `No service: ${holidayReason}` : null);

      const req = requestsByDate.get(serviceDate) ?? null;
      const existing = req
        ? {
            wantsThali: req.wants_thali,
            itemQuantities: (req.item_quantities ?? {}) as Record<string, 0 | 1 | 2>,
          }
        : null;

      return {
        serviceDate,
        dayName,
        menuItems,
        locked,
        isPast,
        isHoliday,
        unavailable,
        unavailableReason,
        existing,
      };
    });
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

      <h2 className="mt-6 text-2xl font-bold">Thali Requests</h2>
      <p className="text-sm text-gray-500">
        Cutoff: {new Date(`1970-01-01T${cutoffTime}`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}, two days before each service date.
      </p>

      <MultiDaySelector
        periods={periods}
        periodDays={periodDays}
        action={submitMultiDayRequestsAction}
      />
    </main>
  );
}
