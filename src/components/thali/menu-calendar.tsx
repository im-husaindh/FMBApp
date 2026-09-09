export type CalendarDay = { serviceDate: string; items: string[] };

export function MenuCalendar({
  days,
  todayDate,
  tomorrowDate,
}: {
  days: CalendarDay[];
  todayDate: string;
  tomorrowDate: string;
}) {
  return (
    <div className="mt-8">
      <h2 className="text-2xl font-bold">Menu Calendar</h2>
      <div className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {days.map((day) => {
          const isToday = day.serviceDate === todayDate;
          const isTomorrow = day.serviceDate === tomorrowDate;
          const isPast = day.serviceDate < todayDate;
          const label = isToday ? 'TODAY' : isTomorrow ? 'TOMORROW' : isPast ? 'PAST' : day.serviceDate;
          return (
            <div
              key={day.serviceDate}
              className={`min-w-[140px] shrink-0 rounded-lg border p-3 ${
                isTomorrow
                  ? 'border-blue-600 bg-blue-50'
                  : isToday
                    ? 'border-green-600 bg-green-50'
                    : isPast
                      ? 'border-gray-200 bg-gray-50 opacity-70'
                      : 'border-gray-200'
              }`}
            >
              <p className="text-sm font-semibold">{label}</p>
              <p className="text-xs text-gray-600">{day.serviceDate}</p>
              <div className="mt-2 text-sm">
                {day.items.length === 0 ? (
                  <p className="text-gray-500">No menu published yet.</p>
                ) : (
                  day.items.slice(0, 3).map((item) => <p key={item}>{item}</p>)
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
