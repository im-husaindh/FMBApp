'use client';

import { useState, useRef } from 'react';
import type { MultiDayRequestItem } from '@/lib/validation/thali-request';

export interface DayData {
  serviceDate: string;
  menuItems: string[];
  locked: boolean;
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
  days: DayData[];
  gravyOptions: { id: string; label: string }[];
  riceOptions: { id: string; label: string }[];
  rotiMin: number;
  rotiMax: number;
  cutoffTime: string;
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
  rotiMin: number
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

export function MultiDaySelector({
  days,
  gravyOptions,
  riceOptions,
  rotiMin,
  rotiMax,
  cutoffTime,
  action,
}: MultiDaySelectorProps) {
  const [dayStates, setDayStates] = useState<Record<string, DayState>>(() => {
    const init: Record<string, DayState> = {};
    for (const day of days) {
      init[day.serviceDate] = defaultState(day.existing, gravyOptions, riceOptions, rotiMin);
    }
    return init;
  });

  const [bulkGravy, setBulkGravy] = useState(gravyOptions[0]?.id ?? '');
  const [bulkRice, setBulkRice] = useState(riceOptions[0]?.id ?? '');
  const [bulkRoti, setBulkRoti] = useState(rotiMin);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const openDays = days.filter((d) => !d.locked && !d.unavailable);

  function applyToAll() {
    setDayStates((prev) => {
      const next = { ...prev };
      for (const day of openDays) {
        next[day.serviceDate] = {
          ...next[day.serviceDate],
          gravyPortionId: bulkGravy,
          ricePortionId: bulkRice,
          rotiQuantity: bulkRoti,
        };
      }
      return next;
    });
  }

  function setDayField<K extends keyof DayState>(
    serviceDate: string,
    field: K,
    value: DayState[K]
  ) {
    setDayStates((prev) => ({
      ...prev,
      [serviceDate]: { ...prev[serviceDate], [field]: value },
    }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
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

  if (days.length === 0) {
    return (
      <p className="mt-6 text-lg text-gray-600">
        No upcoming menus have been approved yet.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Bulk apply */}
      {openDays.length > 0 && (
        <section className="rounded-xl border border-gray-200 p-4">
          <h2 className="text-lg font-semibold">Set for all open days</h2>
          <div className="mt-3 space-y-3">
            <div>
              <label className="text-sm font-medium text-gray-700">Gravy</label>
              <select
                value={bulkGravy}
                onChange={(e) => setBulkGravy(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              >
                {gravyOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">Rice</label>
              <select
                value={bulkRice}
                onChange={(e) => setBulkRice(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              >
                {riceOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-gray-700">
                Roti ({rotiMin}–{rotiMax})
              </label>
              <input
                type="number"
                min={rotiMin}
                max={rotiMax}
                value={bulkRoti}
                onChange={(e) => setBulkRoti(Number(e.target.value))}
                className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
              />
            </div>
            <button
              type="button"
              onClick={applyToAll}
              className="w-full rounded-lg bg-gray-800 px-4 py-3 text-base font-semibold text-white"
            >
              Apply to all open days
            </button>
          </div>
        </section>
      )}

      {/* Per-day rows */}
      <form ref={formRef} onSubmit={handleSubmit}>
        <div className="space-y-3">
          {days.map((day) => {
            const s = dayStates[day.serviceDate];
            const isExpanded = expanded[day.serviceDate] ?? false;

            if (day.unavailable) {
              return (
                <fieldset
                  key={day.serviceDate}
                  className="rounded-xl border border-gray-200 p-4 opacity-60"
                >
                  <legend className="text-base font-semibold">{day.serviceDate}</legend>
                  {day.menuItems.length > 0 && (
                    <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                  )}
                  <p className="mt-2 text-sm text-gray-500">
                    {day.unavailableReason ?? 'Unavailable'}
                  </p>
                </fieldset>
              );
            }

            if (day.locked) {
              return (
                <fieldset
                  key={day.serviceDate}
                  className="rounded-xl border border-gray-200 p-4 opacity-70"
                >
                  <legend className="flex items-center gap-2 text-base font-semibold">
                    {day.serviceDate}
                    <span
                      className="rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600"
                      aria-label="Selections closed"
                    >
                      Closed
                    </span>
                  </legend>
                  {day.menuItems.length > 0 && (
                    <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                  )}
                  <p className="mt-2 text-sm text-gray-600">
                    {s.wantsThali
                      ? `Thali requested — cutoff was ${cutoffTime} two days before`
                      : 'No thali'}
                  </p>
                </fieldset>
              );
            }

            return (
              <fieldset
                key={day.serviceDate}
                className="rounded-xl border border-gray-200 p-4"
              >
                <legend className="text-base font-semibold">{day.serviceDate}</legend>
                {day.menuItems.length > 0 && (
                  <p className="mt-1 text-sm text-gray-500">{day.menuItems.join(' · ')}</p>
                )}
                <div className="mt-3 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setDayField(day.serviceDate, 'wantsThali', true)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      s.wantsThali
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    Yes, Thali
                  </button>
                  <button
                    type="button"
                    onClick={() => setDayField(day.serviceDate, 'wantsThali', false)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      !s.wantsThali
                        ? 'border-gray-800 bg-gray-800 text-white'
                        : 'border-gray-300 text-gray-700'
                    }`}
                  >
                    No Thali
                  </button>
                </div>

                {s.wantsThali && (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => ({
                          ...prev,
                          [day.serviceDate]: !prev[day.serviceDate],
                        }))
                      }
                      className="text-sm text-blue-600 underline"
                    >
                      {isExpanded ? 'Hide portions' : 'Customise portions'}
                    </button>

                    {!isExpanded && (
                      <p className="mt-1 text-sm text-gray-600">
                        {gravyOptions.find((o) => o.id === s.gravyPortionId)?.label ?? '—'} gravy ·{' '}
                        {riceOptions.find((o) => o.id === s.ricePortionId)?.label ?? '—'} rice ·{' '}
                        {s.rotiQuantity} roti
                      </p>
                    )}

                    {isExpanded && (
                      <div className="mt-2 space-y-2">
                        <div>
                          <label className="text-sm font-medium text-gray-700">Gravy</label>
                          <select
                            value={s.gravyPortionId}
                            onChange={(e) =>
                              setDayField(day.serviceDate, 'gravyPortionId', e.target.value)
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                          >
                            {gravyOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">Rice</label>
                          <select
                            value={s.ricePortionId}
                            onChange={(e) =>
                              setDayField(day.serviceDate, 'ricePortionId', e.target.value)
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                          >
                            {riceOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-sm font-medium text-gray-700">
                            Roti ({rotiMin}–{rotiMax})
                          </label>
                          <input
                            type="number"
                            min={rotiMin}
                            max={rotiMax}
                            value={s.rotiQuantity}
                            onChange={(e) =>
                              setDayField(day.serviceDate, 'rotiQuantity', Number(e.target.value))
                            }
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-base"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
            );
          })}
        </div>

        {openDays.length > 0 && (
          <button
            type="submit"
            disabled={pending}
            className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-4 text-xl font-semibold text-white disabled:opacity-50"
          >
            {pending ? 'Saving…' : 'Save All'}
          </button>
        )}
      </form>
    </div>
  );
}
