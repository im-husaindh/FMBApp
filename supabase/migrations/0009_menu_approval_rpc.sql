create or replace function public.approve_menu_version(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_menu_id uuid;
  v_old_approved_id uuid;
  v_status public.menu_version_status;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super_admin may approve a menu version';
  end if;

  select menu_id, status into v_menu_id, v_status
  from public.menu_versions
  where id = p_version_id
  for update;

  if v_menu_id is null then
    raise exception 'Menu version not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'This menu version is not pending approval';
  end if;

  select current_approved_version_id into v_old_approved_id
  from public.menus
  where id = v_menu_id
  for update;

  if v_old_approved_id is not null then
    update public.menu_versions
    set status = 'superseded', updated_at = now()
    where id = v_old_approved_id;
  end if;

  update public.menu_versions
  set status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where id = p_version_id;

  update public.menus
  set current_approved_version_id = p_version_id, updated_at = now()
  where id = v_menu_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
  values (
    auth.uid(),
    'menu_approved',
    'menu_version',
    p_version_id::text,
    jsonb_build_object('status', 'pending_approval'),
    jsonb_build_object('status', 'approved')
  );
end;
$$;

create or replace function public.reject_menu_version(p_version_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.menu_version_status;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super_admin may reject a menu version';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A rejection reason is required';
  end if;

  select status into v_status
  from public.menu_versions
  where id = p_version_id
  for update;

  if v_status is null then
    raise exception 'Menu version not found';
  end if;

  if v_status <> 'pending_approval' then
    raise exception 'This menu version is not pending approval';
  end if;

  update public.menu_versions
  set status = 'rejected',
      rejected_by = auth.uid(),
      rejected_at = now(),
      rejection_reason = p_reason,
      updated_at = now()
  where id = p_version_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, previous_state, new_state)
  values (
    auth.uid(),
    'menu_rejected',
    'menu_version',
    p_version_id::text,
    jsonb_build_object('status', 'pending_approval'),
    jsonb_build_object('status', 'rejected', 'rejection_reason', p_reason)
  );
end;
$$;

grant execute on function public.approve_menu_version(uuid) to authenticated;
grant execute on function public.reject_menu_version(uuid, text) to authenticated;
