import { describe, it, expect } from 'vitest';
import { inviteUserSchema, updateUserSchema } from './user-admin';

describe('inviteUserSchema', () => {
  it('accepts a valid invite', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      userCode: 'US020',
      role: 'user',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'not-an-email',
      userCode: 'US020',
      role: 'user',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown role', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      userCode: 'US020',
      role: 'owner',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty member ID', () => {
    const result = inviteUserSchema.safeParse({
      fullName: 'Priya Nair',
      email: 'priya@example.com',
      userCode: '',
      role: 'user',
    });
    expect(result.success).toBe(false);
  });
});

describe('updateUserSchema', () => {
  it('accepts a valid edit with a mobile number', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: '9990001111',
      email: 'priya@example.com',
      role: 'admin',
      active: 'true',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(true);
    }
  });

  it('accepts a null mobile (FormData.get() returns null for an empty field)', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: null,
      email: 'priya@example.com',
      role: 'user',
      active: 'false',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.active).toBe(false);
    }
  });

  it('rejects an unknown role', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: null,
      email: 'priya@example.com',
      role: 'owner',
      active: 'true',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid active value', () => {
    const result = updateUserSchema.safeParse({
      fullName: 'Priya Nair',
      mobile: null,
      email: 'priya@example.com',
      role: 'user',
      active: 'yes',
    });
    expect(result.success).toBe(false);
  });
});
