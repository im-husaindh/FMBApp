insert into public.app_settings (key, value) values
  ('app_name', '"FMBRequestThali"'),
  ('org_name', '"FMB Community"'),
  ('timezone', '"Asia/Kolkata"'),
  ('cutoff_time', '"23:30"'),
  ('roti_min_qty', '0'),
  ('roti_max_qty', '6')
on conflict (key) do nothing;

insert into public.portion_options (category, label, sort_order) values
  ('gravy', 'Small', 1), ('gravy', 'Regular', 2), ('gravy', 'Large', 3),
  ('rice', 'No Rice', 1), ('rice', 'Small', 2), ('rice', 'Regular', 3), ('rice', 'Large', 4)
on conflict (category, label) do nothing;

-- Seed 14 days of approved menus starting from today (dev only)
do $$
declare
  mid uuid;
  vid uuid;
  d   date;
  items text[][] := array[
    array['Dal Makhani',  'dal'],
    array['Steamed Rice', 'rice'],
    array['Roti',         'roti'],
    array['Aloo Sabzi',   'vegetable']
  ];
  item text[];
  i    int;
begin
  for d in select generate_series(current_date, current_date + 13, '1 day')::date loop
    insert into public.menus (service_date) values (d)
    on conflict (service_date) do nothing
    returning id into mid;
    if mid is null then
      select id into mid from public.menus where service_date = d;
    end if;
    insert into public.menu_versions (menu_id, version_number, status, created_by)
    select mid, 1, 'approved', id from public.profiles where role = 'super_admin' limit 1
    returning id into vid;
    i := 1;
    foreach item slice 1 in array items loop
      insert into public.menu_items (menu_version_id, item_name, category, display_order)
      values (vid, item[1], item[2], i);
      i := i + 1;
    end loop;
    update public.menus set current_approved_version_id = vid where id = mid;
  end loop;
end $$;
