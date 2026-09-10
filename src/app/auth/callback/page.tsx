'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();

    async function run() {
      // Admin-generated links (invite, password reset) use the implicit
      // grant flow: tokens arrive in the URL fragment, which browsers never
      // send to a server. Only client-side JS can read it.
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const accessToken = hashParams.get('access_token');
      const refreshToken = hashParams.get('refresh_token');

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!error) {
          router.replace('/reset-password');
          return;
        }
      }

      // Fallback: PKCE authorization-code flow, in case a link ever arrives
      // as ?code= instead of a fragment.
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          router.replace('/reset-password');
          return;
        }
      }

      router.replace('/login?error=invalid');
    }

    run();
  }, [router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-md text-center">
        <p className="text-lg text-gray-600">Signing you in…</p>
      </div>
    </main>
  );
}
