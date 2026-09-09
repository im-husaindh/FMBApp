import { classifyRequestStatus, type RequestStatus } from './request-status';
import type { ThaliRequestRow, PortionOptionRow } from './daily-summary';

export type ProfileRow = {
  id: string;
  fullName: string;
  userCode: string;
  mobile: string | null;
  email: string | null;
};

export type RequestListRow = {
  userId: string;
  fullName: string;
  userCode: string;
  mobile: string | null;
  email: string | null;
  status: RequestStatus;
  gravyPortionId: string | null;
  gravyLabel: string | null;
  ricePortionId: string | null;
  riceLabel: string | null;
  rotiQuantity: number | null;
};

export type RequestListFilter =
  | 'all'
  | 'thali'
  | 'no_thali'
  | 'no_response'
  | 'on_leave'
  | `gravy:${string}`
  | `rice:${string}`;

export function buildRequestListRows(
  profiles: ProfileRow[],
  requests: ThaliRequestRow[],
  onLeaveUserIds: string[],
  gravyOptions: PortionOptionRow[],
  riceOptions: PortionOptionRow[]
): RequestListRow[] {
  const onLeaveSet = new Set(onLeaveUserIds);
  const requestsByUser = new Map(requests.map((r) => [r.userId, r]));
  const gravyLabelById = new Map(gravyOptions.map((o) => [o.id, o.label]));
  const riceLabelById = new Map(riceOptions.map((o) => [o.id, o.label]));

  return profiles.map((profile) => {
    const request = requestsByUser.get(profile.id);
    const status = classifyRequestStatus(onLeaveSet.has(profile.id), request);
    const hasThali = status === 'thali' && !!request;

    return {
      userId: profile.id,
      fullName: profile.fullName,
      userCode: profile.userCode,
      mobile: profile.mobile,
      email: profile.email,
      status,
      gravyPortionId: hasThali ? request!.gravyPortionId : null,
      gravyLabel: hasThali && request!.gravyPortionId ? gravyLabelById.get(request!.gravyPortionId) ?? null : null,
      ricePortionId: hasThali ? request!.ricePortionId : null,
      riceLabel: hasThali && request!.ricePortionId ? riceLabelById.get(request!.ricePortionId) ?? null : null,
      rotiQuantity: hasThali ? request!.rotiQuantity : null,
    };
  });
}

export function filterRequestListRows(rows: RequestListRow[], filter: RequestListFilter, search: string): RequestListRow[] {
  let result = rows;

  if (filter.startsWith('gravy:')) {
    const id = filter.slice('gravy:'.length);
    result = result.filter((r) => r.gravyPortionId === id);
  } else if (filter.startsWith('rice:')) {
    const id = filter.slice('rice:'.length);
    result = result.filter((r) => r.ricePortionId === id);
  } else if (filter !== 'all') {
    result = result.filter((r) => r.status === filter);
  }

  const term = search.trim().toLowerCase();
  if (term) {
    result = result.filter((r) =>
      [r.fullName, r.userCode, r.mobile, r.email].some((field) => field?.toLowerCase().includes(term))
    );
  }

  return result;
}
