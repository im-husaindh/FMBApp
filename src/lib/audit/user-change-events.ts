export type ProfileSnapshot = {
  fullName: string;
  mobile: string | null;
  email: string;
  role: 'user' | 'admin' | 'super_admin';
  active: boolean;
};

export type UserAuditEvent = {
  action: 'user_edited' | 'user_activated' | 'user_deactivated' | 'role_changed';
  entityType: 'profile';
  entityId: string;
  previousState: Record<string, unknown>;
  newState: Record<string, unknown>;
};

export function computeUserAuditEvents(
  targetId: string,
  previous: ProfileSnapshot,
  next: ProfileSnapshot
): UserAuditEvent[] {
  const events: UserAuditEvent[] = [];

  if (
    previous.fullName !== next.fullName ||
    previous.mobile !== next.mobile ||
    previous.email !== next.email
  ) {
    events.push({
      action: 'user_edited',
      entityType: 'profile',
      entityId: targetId,
      previousState: { fullName: previous.fullName, mobile: previous.mobile, email: previous.email },
      newState: { fullName: next.fullName, mobile: next.mobile, email: next.email },
    });
  }

  if (previous.active !== next.active) {
    events.push({
      action: next.active ? 'user_activated' : 'user_deactivated',
      entityType: 'profile',
      entityId: targetId,
      previousState: { active: previous.active },
      newState: { active: next.active },
    });
  }

  if (previous.role !== next.role) {
    events.push({
      action: 'role_changed',
      entityType: 'profile',
      entityId: targetId,
      previousState: { role: previous.role },
      newState: { role: next.role },
    });
  }

  return events;
}
