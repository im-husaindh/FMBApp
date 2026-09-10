import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { forgotPasswordAction } from './actions';

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-2xl font-bold">Reset Your Password</h1>

        {sent ? (
          <p className="rounded-lg bg-green-50 px-4 py-3 text-center text-lg text-green-700">
            If that email is registered, a reset link has been sent.
          </p>
        ) : (
          <>
            <p className="text-center text-lg text-gray-600">
              Enter your email and we&apos;ll send you a reset link.
            </p>
            {error && (
              <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
                Enter a valid email address.
              </p>
            )}
            <form action={forgotPasswordAction} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="email" className="text-lg">
                  Email
                </Label>
                <Input id="email" name="email" type="email" required className="h-14 text-lg" />
              </div>
              <Button type="submit" className="h-14 w-full text-xl font-semibold">
                SEND RESET LINK
              </Button>
            </form>
          </>
        )}

        <a href="/login" className="block text-center text-lg text-blue-600 underline">
          Back to Login
        </a>
      </div>
    </main>
  );
}
