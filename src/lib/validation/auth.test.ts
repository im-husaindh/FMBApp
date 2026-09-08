import { describe, it, expect } from 'vitest';
import { loginSchema, resetPasswordSchema } from './auth';

describe('loginSchema', () => {
  it('accepts a valid email and password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'secret1' });
    expect(result.success).toBe(true);
  });

  it('rejects a short password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '123' });
    expect(result.success).toBe(false);
  });
});

describe('resetPasswordSchema', () => {
  it('rejects mismatched passwords', () => {
    const result = resetPasswordSchema.safeParse({ password: 'secret1', confirmPassword: 'secret2' });
    expect(result.success).toBe(false);
  });
});
