insert into public.app_settings (key, value) values
  ('app_name', '"FMBRequestThali"'),
  ('org_name', '"FMB Community"'),
  ('timezone', '"Asia/Kolkata"'),
  ('cutoff_time', '"18:00"'),
  ('roti_min_qty', '0'),
  ('roti_max_qty', '6')
on conflict (key) do nothing;

insert into public.portion_options (category, label, sort_order) values
  ('gravy', 'Small', 1), ('gravy', 'Regular', 2), ('gravy', 'Large', 3),
  ('rice', 'No Rice', 1), ('rice', 'Small', 2), ('rice', 'Regular', 3), ('rice', 'Large', 4)
on conflict (category, label) do nothing;
