import type { SupabaseClient } from '@supabase/supabase-js';

export const NOTIFICATION_TYPES = {
  CONCERN_RESPONSE: 'concern_response',
  CONCERN_RESOLVED: 'concern_resolved',
} as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

/**
 * The only thing that writes to `notifications`. Callers never touch the
 * table directly, so a future delivery channel (WhatsApp/SMS/email/push)
 * can be added inside this one function without changing any call site.
 * Takes the caller's own Supabase client (same shape as lib/settings'
 * getSettings) rather than creating its own — matches every other
 * cross-cutting helper in this codebase.
 */
export async function notify(
  supabase: SupabaseClient,
  recipientId: string,
  type: NotificationType,
  payload: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    recipient_id: recipientId,
    type,
    payload,
  });
  if (error) {
    // A failed notification must never block the action that triggered it
    // (e.g. an admin's concern reply) — log and continue.
    console.error(`Failed to create notification (${type}) for ${recipientId}:`, error.message);
  }
}
