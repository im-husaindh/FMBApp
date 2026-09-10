-- 0020 replaced this function from migration 0001's original body and
-- silently dropped the service_role bypass that 0006 had added — without
-- it, a service-role client (used by scripts/seed-users.ts and this
-- phase's inviteUserAction) cannot set a newly-created user's role, since
-- auth.uid() is not meaningfully set for a service-role request. This
-- restores that bypass as the first check, keeping 0020's self-lockout
-- addition exactly where it was for every other (non-service-role) case.
create or replace function public.profiles_prevent_role_active_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    new.updated_at = now();
    return new;
  end if;

  if (new.role is distinct from old.role or new.active is distinct from old.active) then
    if new.id = auth.uid() then
      raise exception 'You cannot change your own role or active status';
    end if;
    if not exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'super_admin' and p.active = true
    ) then
      raise exception 'Only an active super_admin may change role or active status';
    end if;
  end if;
  new.updated_at = now();
  return new;
end;
$$;
