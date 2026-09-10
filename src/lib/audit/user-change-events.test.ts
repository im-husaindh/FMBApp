import { describe, it, expect } from 'vitest';
import { computeUserAuditEvents } from './user-change-events';

const base = {
  fullName: 'Asha Mehta',
  mobile: '9990001111',
  email: 'asha@example.com',
  role: 'user' as const,
  active: true,
};

describe('computeUserAuditEvents', () => {
  it('emits nothing when nothing changed', () => {
    expect(computeUserAuditEvents('u1', base, { ...base })).toEqual([]);
  });

  it('emits a user_edited event when contact info changes', () => {
    const events = computeUserAuditEvents('u1', base, { ...base, mobile: '9990002222' });
    expect(events).toEqual([
      {
        action: 'user_edited',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { fullName: base.fullName, mobile: base.mobile, email: base.email },
        newState: { fullName: base.fullName, mobile: '9990002222', email: base.email },
      },
    ]);
  });

  it('emits user_deactivated when active flips to false', () => {
    const events = computeUserAuditEvents('u1', base, { ...base, active: false });
    expect(events).toEqual([
      {
        action: 'user_deactivated',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { active: true },
        newState: { active: false },
      },
    ]);
  });

  it('emits user_activated when active flips to true', () => {
    const inactive = { ...base, active: false };
    const events = computeUserAuditEvents('u1', inactive, { ...inactive, active: true });
    expect(events).toEqual([
      {
        action: 'user_activated',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { active: false },
        newState: { active: true },
      },
    ]);
  });

  it('emits role_changed when role changes', () => {
    const events = computeUserAuditEvents('u1', base, { ...base, role: 'admin' });
    expect(events).toEqual([
      {
        action: 'role_changed',
        entityType: 'profile',
        entityId: 'u1',
        previousState: { role: 'user' },
        newState: { role: 'admin' },
      },
    ]);
  });

  it('emits three events, one per changed aspect, when everything changes at once', () => {
    const events = computeUserAuditEvents('u1', base, {
      fullName: 'Asha M.',
      mobile: base.mobile,
      email: base.email,
      role: 'admin',
      active: false,
    });
    expect(events.map((e) => e.action)).toEqual(['user_edited', 'user_deactivated', 'role_changed']);
  });
});
