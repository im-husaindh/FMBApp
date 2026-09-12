'use client';

import { useRouter } from 'next/navigation';

export function BackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-4 flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"
    >
      ← Back
    </button>
  );
}
