function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = p.value;
    return acc;
  }, {});
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return (asUtc - date.getTime()) / 60000;
}

/** Converts a wall-clock date+time in `timeZone` to the equivalent UTC instant. */
export function zonedTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const naiveUtc = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offsetMinutes = getTimezoneOffsetMinutes(new Date(naiveUtc), timeZone);
  return new Date(naiveUtc - offsetMinutes * 60000);
}

/** The UTC instant at which the selection window for `serviceDate` closes. */
export function cutoffInstant(serviceDate: string, timeZone: string, cutoffTime: string): Date {
  const [y, m, d] = serviceDate.split('-').map(Number);
  const twoDaysBefore = new Date(Date.UTC(y, m - 1, d));
  twoDaysBefore.setUTCDate(twoDaysBefore.getUTCDate() - 2);
  const prevDateStr = twoDaysBefore.toISOString().slice(0, 10);
  return zonedTimeToUtc(prevDateStr, cutoffTime, timeZone);
}

/** True if `nowUtc` is strictly before the cutoff for `serviceDate`. Never pass a client-supplied clock. */
export function isBeforeCutoff(
  serviceDate: string,
  timeZone: string,
  cutoffTime: string,
  nowUtc: Date = new Date()
): boolean {
  return nowUtc.getTime() < cutoffInstant(serviceDate, timeZone, cutoffTime).getTime();
}

/** Today's date (YYYY-MM-DD) as a wall-clock date in `timeZone`. */
export function todayInTimezone(timeZone: string, nowUtc: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(nowUtc);
}

/** Inclusive YYYY-MM-DD range: `daysBefore` days before today through `daysAfter` days after, in `timeZone`. */
export function serviceDateRange(
  timeZone: string,
  daysBefore: number,
  daysAfter: number,
  nowUtc: Date = new Date()
): string[] {
  const today = todayInTimezone(timeZone, nowUtc);
  const [y, m, d] = today.split('-').map(Number);
  const dates: string[] = [];
  for (let offset = -daysBefore; offset <= daysAfter; offset++) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + offset);
    dates.push(dt.toISOString().slice(0, 10));
  }
  return dates;
}

/** Adds (or subtracts, with a negative value) whole days to a YYYY-MM-DD date string. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
