'use client';

import { useEffect, useState } from 'react';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // initial sync read of navigator.onLine must happen client-side only;
    // navigator doesn't exist during SSR (a lazy useState initializer would run
    // during SSR and read the wrong value).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOffline(!navigator.onLine);
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div role="status" className="bg-amber-50 px-4 py-2 text-center text-sm text-amber-800">
      You&apos;re offline. Some actions won&apos;t work until your connection returns.
    </div>
  );
}
