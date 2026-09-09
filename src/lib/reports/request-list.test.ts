import { describe, it, expect } from 'vitest';
import { buildRequestListRows, filterRequestListRows, type ProfileRow } from './request-list';
import type { ThaliRequestRow, PortionOptionRow } from './daily-summary';

const profiles: ProfileRow[] = [
  { id: 'u1', fullName: 'Amina Khan', userCode: 'M001', mobile: '9990001111', email: 'amina@example.com' },
  { id: 'u2', fullName: 'Bilal Sheikh', userCode: 'M002', mobile: '9990002222', email: 'bilal@example.com' },
  { id: 'u3', fullName: 'Chandni Rao', userCode: 'M003', mobile: null, email: null },
  { id: 'u4', fullName: 'Dawood Ali', userCode: 'M004', mobile: '9990004444', email: 'dawood@example.com' },
];

const gravyOptions: PortionOptionRow[] = [{ id: 'g1', label: 'Small' }, { id: 'g2', label: 'Regular' }];
const riceOptions: PortionOptionRow[] = [{ id: 'r1', label: 'No Rice' }, { id: 'r2', label: 'Small' }];

const requests: ThaliRequestRow[] = [
  { userId: 'u1', wantsThali: true, gravyPortionId: 'g1', ricePortionId: 'r1', rotiQuantity: 2 },
  { userId: 'u2', wantsThali: false, gravyPortionId: null, ricePortionId: null, rotiQuantity: null },
  { userId: 'u4', wantsThali: true, gravyPortionId: 'g2', ricePortionId: 'r2', rotiQuantity: 3 },
];

describe('buildRequestListRows', () => {
  it('classifies each profile and attaches profile info and portion labels', () => {
    const rows = buildRequestListRows(profiles, requests, ['u4'], gravyOptions, riceOptions);
    const byId = new Map(rows.map((r) => [r.userId, r]));

    expect(byId.get('u1')).toMatchObject({
      fullName: 'Amina Khan',
      userCode: 'M001',
      status: 'thali',
      gravyPortionId: 'g1',
      gravyLabel: 'Small',
      ricePortionId: 'r1',
      riceLabel: 'No Rice',
      rotiQuantity: 2,
    });
    expect(byId.get('u2')).toMatchObject({ status: 'no_thali', gravyPortionId: null, gravyLabel: null });
    expect(byId.get('u3')).toMatchObject({ status: 'no_response' });
    // u4 has a thali request row but is on leave — leave must win.
    expect(byId.get('u4')).toMatchObject({ status: 'on_leave', gravyPortionId: null, gravyLabel: null });
  });
});

describe('filterRequestListRows', () => {
  const rows = buildRequestListRows(profiles, requests, ['u4'], gravyOptions, riceOptions);

  it('"all" returns every row', () => {
    expect(filterRequestListRows(rows, 'all', '')).toHaveLength(4);
  });

  it('filters by status', () => {
    expect(filterRequestListRows(rows, 'thali', '').map((r) => r.userId)).toEqual(['u1']);
    expect(filterRequestListRows(rows, 'no_thali', '').map((r) => r.userId)).toEqual(['u2']);
    expect(filterRequestListRows(rows, 'no_response', '').map((r) => r.userId)).toEqual(['u3']);
    expect(filterRequestListRows(rows, 'on_leave', '').map((r) => r.userId)).toEqual(['u4']);
  });

  it('filters by exact gravy portion id', () => {
    expect(filterRequestListRows(rows, 'gravy:g1', '').map((r) => r.userId)).toEqual(['u1']);
  });

  it('filters by exact rice portion id', () => {
    expect(filterRequestListRows(rows, 'rice:r2', '').map((r) => r.userId)).toEqual([]);
    // u4's rice portion is r2, but u4 is on_leave so it has no rice portion recorded — confirms leave zeroes out portion fields.
  });

  it('searches case-insensitively across name, user code, mobile, and email', () => {
    expect(filterRequestListRows(rows, 'all', 'amina').map((r) => r.userId)).toEqual(['u1']);
    expect(filterRequestListRows(rows, 'all', 'M002').map((r) => r.userId)).toEqual(['u2']);
    expect(filterRequestListRows(rows, 'all', '9990004444').map((r) => r.userId)).toEqual(['u4']);
    expect(filterRequestListRows(rows, 'all', 'bilal@example').map((r) => r.userId)).toEqual(['u2']);
  });

  it('combines a status filter and a search with AND', () => {
    expect(filterRequestListRows(rows, 'thali', 'bilal')).toHaveLength(0);
    expect(filterRequestListRows(rows, 'thali', 'amina')).toHaveLength(1);
  });
});
