do $$
declare
  table_name text;
begin
  if not exists (
    select 1 from pg_catalog.pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  foreach table_name in array array[
    'orders',
    'station_applications',
    'stations',
    'payments',
    'station_reviews',
    'user_roles'
  ]
  loop
    if not exists (
      select 1
      from pg_catalog.pg_publication_tables p
      where p.pubname = 'supabase_realtime'
        and p.schemaname = 'public'
        and p.tablename = table_name
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I',
        table_name
      );
    end if;
  end loop;
end;
$$;
