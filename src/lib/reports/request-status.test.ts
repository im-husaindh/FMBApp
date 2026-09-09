import { describe, it, expect } from 'vitest';
import { classifyRequestStatus } from './request-status';

describe('classifyRequestStatus', () => {
  it('returns on_leave when the user is on leave, regardless of any request row', () => {
    expect(classifyRequestStatus(true, undefined)).toBe('on_leave');
    expect(classifyRequestStatus(true, { wantsThali: true })).toBe('on_leave');
  });

  it('returns no_response when not on leave and there is no request row', () => {
    expect(classifyRequestStatus(false, undefined)).toBe('no_response');
  });

  it('returns no_thali when not on leave and the request says wantsThali=false', () => {
    expect(classifyRequestStatus(false, { wantsThali: false })).toBe('no_thali');
  });

  it('returns thali when not on leave and the request says wantsThali=true', () => {
    expect(classifyRequestStatus(false, { wantsThali: true })).toBe('thali');
  });

  it('leave overrides even a stale thali request row (the precedence that matters most)', () => {
    expect(classifyRequestStatus(true, { wantsThali: true })).toBe('on_leave');
  });
});
