import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginAction } from './actions';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-3xl font-bold">FMBRequestThali</h1>
          <p className="mt-1 text-lg text-gray-600">Welcome</p>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-center text-lg text-red-700">
            Incorrect email or password.
          </p>
        )}

        <form action={loginAction} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email" className="text-lg">
              Email
            </Label>
            <Input id="email" name="email" type="email" required className="h-14 text-lg" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password" className="text-lg">
              Password
            </Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              className="h-14 text-lg"
            />
          </div>
          <Button type="submit" className="h-14 w-full text-xl font-semibold">
            LOGIN
          </Button>
        </form>

        <a href="/forgot-password" className="block text-center text-lg text-blue-600 underline">
          Forgot Password?
        </a>
      </div>
    </main>
  );
}
