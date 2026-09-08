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
