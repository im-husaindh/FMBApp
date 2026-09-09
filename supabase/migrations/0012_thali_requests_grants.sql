revoke insert (id, submitted_at, created_at, locked_at, source),
       update (id, submitted_at, created_at, locked_at, source)
  on public.thali_requests from authenticated, anon;
