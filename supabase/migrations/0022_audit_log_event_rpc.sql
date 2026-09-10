-- 0022_audit_log_event_rpc.sql
-- Generic audit-insert function extending the SECURITY DEFINER pattern
-- already proven by approve_menu_version/reject_menu_version (0009):
-- actor_id is always auth.uid(), set inside the function, never
-- client-supplied — a client cannot spoof who performed an action.

create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id text,
  p_previous_state jsonb default null,
  p_new_state jsonb default null,
  p_ip_address text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin or super_admin may write an audit log entry';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state, ip_address)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_previous_state, p_new_state, p_ip_address);
end;
$$;

grant execute on function public.log_audit_event(text, text, text, jsonb, jsonb, text) to authenticated;
