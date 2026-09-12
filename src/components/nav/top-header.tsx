import { logoutAction } from '@/app/(app)/actions';

export function TopHeader() {
  return (
    <header
      role="banner"
      className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3"
    >
      <span className="text-lg font-bold tracking-tight">FMB</span>
      <form action={logoutAction}>
        <button
          type="submit"
          className="text-sm font-medium text-blue-600 underline"
        >
          Log Out
        </button>
      </form>
    </header>
  );
}
