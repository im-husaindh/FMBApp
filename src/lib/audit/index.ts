import { headers } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

export type AuditEventParams = {
  action: string;
  entityType: string;
  entityId: string;
  previousState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
};

export async function getRequestIp(): Promise<string | null> {
  const h = await headers();
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
}

export async function logAuditEvent(
  supabase: SupabaseClient,
  params: AuditEventParams
): Promise<void> {
  const ip = await getRequestIp();
  const { error } = await supabase.rpc('log_audit_event', {
    p_action: params.action,
    p_entity_type: params.entityType,
    p_entity_id: params.entityId,
    p_previous_state: params.previousState ?? null,
    p_new_state: params.newState ?? null,
    p_ip_address: ip,
  });
  if (error) {
    console.error('logAuditEvent failed', {
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      error,
    });
  }
}
