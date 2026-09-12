'use client';

import { useState } from 'react';
import type { BiweeklyPeriod } from '@/lib/time/cutoff';
import type { MultiDayRequestItem } from '@/lib/validation/thali-request';

const CATEGORY_ICON: Record<string, string> = {
  gravy:     '🍲',
  dal:       '🫕',
  rice:      '🍚',
  roti:      '🫓',
  vegetable: '🥦',
  salad:     '🥗',
  sweet:     '🍮',
  other:     '🍽️',
};

export interface DayData {
  serviceDate: string;
  dayName: string;
  menuItems: { name: string; category: string }[];
  locked: boolean;
  isPast: boolean;
  /** Day is in the service_holidays table — an actual declared holiday */
  isServiceHoliday: boolean;
  /** No approved menu uploaded yet (but not a holiday) */
  noMenu: boolean;
  unavailable: boolean;
  unavailableReason: string | null;
  existing: {
    wantsThali: boolean;
    itemQuantities: Record<string, 0 | 1 | 2>;
  } | null;
}

export interface MultiDaySelectorProps {
  periods: BiweeklyPeriod[];
  periodDays: DayData[][];
  action: (formData: FormData) => Promise<void>;
}

type DayState = {
  wantsThali: boolean;
  itemQuantities: Record<string, 0 | 1 | 2>;
};

function defaultState(existing: DayData['existing'], menuItems: DayData['menuItems']): DayState {
  if (existing) {
    // Fill in any menu items missing from a previous save
    const quantities: Record<string, 0 | 1 | 2> = {};
    for (const item of menuItems) {
      quantities[item.name] = (existing.itemQuantities[item.name] as 0 | 1 | 2 | undefined) ?? 1;
    }
    return { wantsThali: existing.wantsThali, itemQuantities: quantities };
  }
  const quantities: Record<string, 0 | 1 | 2> = {};
  for (const item of menuItems) quantities[item.name] = 1;
  return { wantsThali: true, itemQuantities: quantities };
}

function applyServingPreset(serving: 0 | 1 | 2, menuItems: DayData['menuItems']): DayState {
  const quantities: Record<string, 0 | 1 | 2> = {};
  for (const item of menuItems) quantities[item.name] = serving;
  return { wantsThali: serving > 0, itemQuantities: quantities };
}

function formatDateDisplay(serviceDate: string, dayName: string): string {
  const [y, m, d] = serviceDate.split('-').map(Number);
  const dayPart = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  return `${dayName}, ${dayPart}`;
}

export function MultiDaySelector({ periods, periodDays, action }: MultiDaySelectorProps) {
  const [selectedPeriod, setSelectedPeriod] = useState(0);
  const [bulkServing, setBulkServing] = useState<0 | 1 | 2>(1);
  const [dayStates, setDayStates] = useState<Record<string, DayState>>(() => {
    const init: Record<string, DayState> = {};
    for (const days of periodDays) {
      for (const day of days) {
        init[day.serviceDate] = defaultState(day.existing, day.menuItems);
      }
    }
    return init;
  });
  const [pending, setPending] = useState(false);

  const currentDays = periodDays[selectedPeriod] ?? [];
  const openDays = currentDays.filter((d) => !d.locked && !d.isPast && !d.isServiceHoliday && !d.noMenu && !d.unavailable);

  function applyBulkToAll() {
    setDayStates((prev) => {
      const next = { ...prev };
      for (const day of openDays) {
        next[day.serviceDate] = applyServingPreset(bulkServing, day.menuItems);
      }
      return next;
    });
  }

  function setItemQuantity(serviceDate: string, item: string, qty: 0 | 1 | 2) {
    setDayStates((prev) => {
      const current = prev[serviceDate];
      const newQuantities = { ...current.itemQuantities, [item]: qty };
      const anyWanted = Object.values(newQuantities).some((v) => v > 0);
      return {
        ...prev,
        [serviceDate]: { wantsThali: anyWanted, itemQuantities: newQuantities },
      };
    });
  }

  function setNotRequired(serviceDate: string, notRequired: boolean, menuItems: DayData['menuItems']) {
    if (notRequired) {
      setDayStates((prev) => ({
        ...prev,
        [serviceDate]: applyServingPreset(0, menuItems),
      }));
    } else {
      setDayStates((prev) => ({
        ...prev,
        [serviceDate]: applyServingPreset(1, menuItems),
      }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (openDays.length === 0) return;
    setPending(true);
    const payload: MultiDayRequestItem[] = openDays.map((day) => {
      const s = dayStates[day.serviceDate];
      return {
        serviceDate: day.serviceDate,
        wantsThali: s.wantsThali,
        itemQuantities: s.itemQuantities,
      };
    });
    const fd = new FormData();
    fd.append('multiDayRequests', JSON.stringify(payload));
    try {
      await action(fd);
    } finally {
      setPending(false);
    }
  }

  if (periods.length === 0) {
    return <p className="mt-6 text-gray-600">No upcoming menus have been approved yet.</p>;
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Period selector */}
      <div>
        <label className="block text-sm font-medium text-gray-700">Select period</label>
        <select
          value={selectedPeriod}
          onChange={(e) => setSelectedPeriod(Number(e.target.value))}
          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
        >
          {periods.map((p, i) => (
            <option key={p.start} value={i}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {/* Bulk apply */}
      {openDays.length > 0 && (
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-700">Mark for all below menus</p>
          <div className="mt-2 flex gap-6">
            {([0, 1, 2] as const).map((n) => (
              <label key={n} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="bulk-serving"
                  checked={bulkServing === n}
                  onChange={() => setBulkServing(n)}
                  className="accent-blue-600"
                />
                <span className="text-sm">{n} Serving</span>
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={applyBulkToAll}
            className="mt-3 w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-semibold text-white"
          >
            Apply to all open days
          </button>
        </div>
      )}

      {/* Day tiles */}
      <form onSubmit={handleSubmit} className="space-y-3">
        {currentDays.map((day) => {
          const s = dayStates[day.serviceDate];
          const dateLabel = formatDateDisplay(day.serviceDate, day.dayName);

          if (day.isServiceHoliday) {
            return (
              <div
                key={day.serviceDate}
                className={`rounded-xl border border-dashed border-gray-200 px-4 py-3 ${day.isPast ? 'opacity-35' : 'opacity-55'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-500">{dateLabel}</span>
                  <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                    Holiday
                  </span>
                </div>
              </div>
            );
          }

          if (day.noMenu) {
            return (
              <div
                key={day.serviceDate}
                className={`rounded-xl border border-dashed border-gray-200 px-4 py-3 ${day.isPast ? 'opacity-35' : 'opacity-55'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-gray-500">{dateLabel}</span>
                  <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
                    Yet to be decided
                  </span>
                </div>
              </div>
            );
          }

          if (day.unavailable) {
            return (
              <div key={day.serviceDate} className="rounded-xl border border-gray-200 px-4 py-3 opacity-60">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{dateLabel}</span>
                  <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-xs font-medium text-yellow-700">
                    Unavailable
                  </span>
                </div>
                {day.menuItems.length > 0 && (
                  <p className="mt-1 text-sm text-gray-500">
                    {day.menuItems.map((i) => `${CATEGORY_ICON[i.category] ?? '🍽️'} ${i.name}`).join(' · ')}
                  </p>
                )}
                {day.unavailableReason && (
                  <p className="mt-0.5 text-xs text-gray-400">{day.unavailableReason}</p>
                )}
              </div>
            );
          }

          if (day.isPast || day.locked) {
            return (
              <div
                key={day.serviceDate}
                className={`rounded-xl border border-gray-200 px-4 py-3 ${day.isPast ? 'opacity-40' : 'opacity-70'}`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{dateLabel}</span>
                  <span className="rounded-full bg-gray-200 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                    Closed
                  </span>
                </div>
                {day.menuItems.length > 0 && (
                  <p className="mt-1 text-sm text-gray-500">
                    {day.menuItems.map((i) => `${CATEGORY_ICON[i.category] ?? '🍽️'} ${i.name}`).join(' · ')}
                  </p>
                )}
                <p className="mt-1 text-sm text-gray-500">
                  {s?.wantsThali ? 'Thali requested' : 'No thali'}
                </p>
              </div>
            );
          }

          // Open day
          return (
            <div key={day.serviceDate} className="rounded-xl border border-gray-200 px-4 py-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <p className="font-semibold">{dateLabel}</p>
              </div>

              {/* "Not Required" toggle */}
              <label className="mt-2 flex cursor-pointer items-center gap-2 border-b border-gray-100 pb-3 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={!s.wantsThali}
                  onChange={(e) => setNotRequired(day.serviceDate, e.target.checked, day.menuItems)}
                  className="h-4 w-4 rounded accent-gray-700"
                />
                If Thali Not Required — Tick Here
              </label>

              {/* Per-item quantity rows */}
              {s.wantsThali && day.menuItems.length > 0 && (
                <div className="mt-1 divide-y divide-gray-100">
                  {day.menuItems.map((item) => (
                    <div key={item.name} className="flex items-center justify-between py-2.5">
                      <span className="text-sm font-medium">
                        {CATEGORY_ICON[item.category] ?? '🍽️'} {item.name}
                      </span>
                      <div className="flex gap-4">
                        {([0, 1, 2] as const).map((n) => (
                          <label key={n} className="flex cursor-pointer items-center gap-1 text-sm">
                            <input
                              type="radio"
                              name={`item-${day.serviceDate}-${item.name}`}
                              checked={(s.itemQuantities[item.name] ?? 1) === n}
                              onChange={() => setItemQuantity(day.serviceDate, item.name, n)}
                              className="accent-blue-600"
                            />
                            {n}
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {openDays.length > 0 && (
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl bg-blue-600 px-4 py-4 text-lg font-semibold text-white disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save All'}
          </button>
        )}

        {openDays.length === 0 && currentDays.length > 0 && (
          <p className="text-center text-sm text-gray-500">
            All days in this period are closed or unavailable.
          </p>
        )}
      </form>
    </div>
  );
}
