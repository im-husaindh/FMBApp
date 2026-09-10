import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { resetPasswordAction } from './actions';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold">Set a New Password</h1>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
            {error === 'failed'
              ? 'Could not update your password. The reset link may have expired.'
              : 'Passwords must match and be at least 6 characters.'}
          </p>
        )}

        <form action={resetPasswordAction} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="password" className="text-lg">
              New Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className="h-14 text-lg"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirmPassword" className="text-lg">
              Confirm Password
            </Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={6}
              className="h-14 text-lg"
            />
          </div>
          <Button type="submit" className="h-14 w-full text-xl font-semibold">
            UPDATE PASSWORD
          </Button>
        </form>
      </div>
    </main>
  );
}
