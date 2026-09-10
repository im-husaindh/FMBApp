-- Extends the Phase 1 trigger (0001_profiles.sql) to also reject a role or
-- active-status change where the target row is the acting user's own —
-- even if they are a genuinely active super_admin. Without this, a super_admin
-- could accidentally demote or deactivate themselves with no other
-- super_admin able to undo it, since Phase 5 is the first UI to ever expose
-- this write path.
create or replace function public.profiles_prevent_role_active_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
