export type RequestStatus = 'thali' | 'no_thali' | 'no_response' | 'on_leave';

/**
 * The one place this app decides what a user's status is for a date. A leave
 * day overrides even a stale thali_requests row — checked first — because
 * leave/holiday enforcement (Phase 3b-core) only blocks NEW writes; a leave
 * added after a user already submitted a request does not retroactively
 * delete that row.
 */
export function classifyRequestStatus(
  isOnLeave: boolean,
  request: { wantsThali: boolean } | undefined
): RequestStatus {
  if (isOnLeave) return 'on_leave';
  if (!request) return 'no_response';
  return request.wantsThali ? 'thali' : 'no_thali';
}
