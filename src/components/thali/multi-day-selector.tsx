'use client';

import { useState } from 'react';
import type { BiweeklyPeriod } from '@/lib/time/cutoff';
import type { MultiDayRequestItem } from '@/lib/validation/thali-request';

export interface DayData {
  serviceDate: string;
  dayName: string;
  menuItems: string[];
  locked: boolean;
  isPast: boolean;
  isHoliday: boolean;
  unavailable: boolean;
  unavailableReason: string | null;
  existing: {
    wantsThali: boolean;
    gravyPortionId: string | null;
    ricePortionId: string | null;
    rotiQuantity: number | null;
  } | null;
}

export interface MultiDaySelectorProps {
  periods: BiweeklyPeriod[];
  periodDays: DayData[][];
  gravyOptions: { id: string; label: string }[];
  riceOptions: { id: string; label: string }[];
  rotiMin: number;
  rotiMax: number;
  action: (formData: FormData) => Promise<void>;
}

type DayState = {
  wantsThali: boolean;
  gravyPortionId: string;
  ricePortionId: string;
  rotiQuantity: number;
};

function defaultState(
  existing: DayData['existing'],
  gravyOptions: { id: string }[],
  riceOptions: { id: string }[],
  rotiMin: number,
): DayState {
  if (existing?.wantsThali) {
    return {
      wantsThali: true,
      gravyPortionId: existing.gravyPortionId ?? gravyOptions[0]?.id ?? '',
      ricePortionId: existing.ricePortionId ?? riceOptions[0]?.id ?? '',
      rotiQuantity: existing.rotiQuantity ?? rotiMin,
    };
  }
  if (existing && !existing.wantsThali) {
    return {
      wantsThali: false,
      gravyPortionId: gravyOptions[0]?.id ?? '',
      ricePortionId: riceOptions[0]?.id ?? '',
      rotiQuantity: rotiMin,
    };
  }
  return {
    wantsThali: true,
    gravyPortionId: gravyOptions[0]?.id ?? '',
    ricePortionId: riceOptions[0]?.id ?? '',
    rotiQuantity: rotiMin,
  };
}

function applyServingPreset(
  serving: 0 | 1 | 2,
  gravyOptions: { id: string; label: string }[],
  riceOptions: { id: string; label: string }[],
  rotiMin: number,
  rotiMax: number,
  current: DayState,
): DayState {
  if (serving === 0) return { ...current, wantsThali: false };
  const rotiMid = Math.round((rotiMin + rotiMax) / 2);
  if (serving === 1) {
    const gravy = gravyOptions.find((o) => o.label === 'Regular') ?? gravyOptions[0];
    const rice = riceOptions.find((o) => o.label === 'Regular') ?? riceOptions[0];
    return {
      wantsThali: true,
      gravyPortionId: gravy?.id ?? current.gravyPortionId,
      ricePortionId: rice?.id ?? current.ricePortionId,
      rotiQuantity: rotiMid,
    };
  }
  const gravy = gravyOptions.find((o) => o.label === 'Large') ?? gravyOptions[gravyOptions.length - 1];
  const rice = riceOptions.find((o) => o.label === 'Large') ?? riceOptions[riceOptions.length - 1];
  return {
    wantsThali: true,
    gravyPortionId: gravy?.id ?? current.gravyPortionId,
    ricePortionId: rice?.id ?? current.ricePortionId,
    rotiQuantity: rotiMax,
  };
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

export function MultiDaySelector({
  periods,
  periodDays,
  gravyOptions,
  riceOptions,
  rotiMin,
  rotiMax,
  action,
}: MultiDaySelectorProps) {
  const [selectedPeriod, setSelectedPeriod] = useState(0);
  const [bulkServing, setBulkServing] = useState<0 | 1 | 2>(1);
  const [dayStates, setDayStates] = useState<Record<string, DayState>>(() => {
    const init: Record<string, DayState> = {};
    for (const days of periodDays) {
      for (const day of days) {
        init[day.serviceDate] = defaultState(day.existing, gravyOptions, riceOptions, rotiMin);
      }
    }
    return init;
  });
  const [pending, setPending] = useState(false);

  const currentDays = periodDays[selectedPeriod] ?? [];
  const openDays = currentDays.filter((d) => !d.locked && !d.isPast && !d.isHoliday && !d.unavailable);

  function applyBulkToAll() {
    setDayStates((prev) => {
      const next = { ...prev };
      for (const day of openDays) {
        next[day.serviceDate] = applyServingPreset(
          bulkServing,
          gravyOptions,
          riceOptions,
          rotiMin,
          rotiMax,
          next[day.serviceDate],
        );
      }
      return next;
    });
  }

  function setDayField<K extends keyof DayState>(serviceDate: string, field: K, value: DayState[K]) {
    setDayStates((prev) => ({
      ...prev,
      [serviceDate]: { ...prev[serviceDate], [field]: value },
    }));
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
        gravyPortionId: s.wantsThali ? s.gravyPortionId : null,
        ricePortionId: s.wantsThali ? s.ricePortionId : null,
        rotiQuantity: s.wantsThali ? s.rotiQuantity : null,
      };
    });
    const fd = new FormData();
    fd.append('multiDayRequests', JSON.stringify(payload));
    await action(fd);
    setPending(false);
  }

  if (periods.length === 0) {
    return (
      <p className="mt-6 text-gray-600">No upcoming menus have been approved yet.</p>
    );
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

          if (day.isHoliday) {
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
                  <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
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
                  <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                )}
                <p className="mt-1 text-sm text-gray-500">
                  {s?.wantsThali
                    ? `${gravyOptions.find((o) => o.id === s.gravyPortionId)?.label ?? '—'} gravy · ${riceOptions.find((o) => o.id === s.ricePortionId)?.label ?? '—'} rice · ${s.rotiQuantity} roti`
                    : 'No thali'}
                </p>
              </div>
            );
          }

          // Open day
          return (
            <div key={day.serviceDate} className="rounded-xl border border-gray-200 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold">{dateLabel}</p>
                  {day.menuItems.length > 0 && (
                    <p className="mt-0.5 truncate text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                  )}
                </div>
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 pt-0.5">
                  <input
                    type="checkbox"
                    checked={!s.wantsThali}
                    onChange={(e) => setDayField(day.serviceDate, 'wantsThali', !e.target.checked)}
                    className="h-4 w-4 rounded accent-gray-700"
                  />
                  <span className="whitespace-nowrap text-sm text-gray-600">Skip</span>
                </label>
              </div>

              {s.wantsThali && (
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-500">Gravy</label>
                    <select
                      value={s.gravyPortionId}
                      onChange={(e) => setDayField(day.serviceDate, 'gravyPortionId', e.target.value)}
                      className="mt-0.5 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {gravyOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Rice</label>
                    <select
                      value={s.ricePortionId}
                      onChange={(e) => setDayField(day.serviceDate, 'ricePortionId', e.target.value)}
                      className="mt-0.5 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      {riceOptions.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">
                      Roti ({rotiMin}–{rotiMax})
                    </label>
                    <input
                      type="number"
                      min={rotiMin}
                      max={rotiMax}
                      value={s.rotiQuantity}
                      onChange={(e) => setDayField(day.serviceDate, 'rotiQuantity', Number(e.target.value))}
                      className="mt-0.5 block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
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
