create table if not exists public.station_riders (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations(id) on delete cascade,
  rider_number integer not null check (rider_number > 0),
  name text not null check (length(trim(name)) between 1 and 100),
  phone text not null check (length(trim(phone)) between 1 and 32),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (station_id, rider_number)
);

create index if not exists station_riders_station_idx
  on public.station_riders(station_id, rider_number);

alter table public.deliveries
  add column if not exists rider_number integer check (rider_number is null or rider_number > 0);

create table if not exists public.station_rider_number_counters (
  station_id uuid primary key references public.stations(id) on delete cascade,
  last_rider_number integer not null default 0 check (last_rider_number >= 0)
);

alter table public.station_riders enable row level security;
alter table public.station_rider_number_counters enable row level security;

drop policy if exists "Station members view their delivery riders" on public.station_riders;
create policy "Station members view their delivery riders"
  on public.station_riders for select to authenticated
  using ((select public.is_station_member(station_id)));

drop policy if exists "Station managers manage their delivery riders" on public.station_riders;
create policy "Station managers manage their delivery riders"
  on public.station_riders for all to authenticated
  using ((select public.is_station_manager(station_id)))
  with check ((select public.is_station_manager(station_id)));

create or replace function public.create_station_rider(
  p_station_id uuid,
  p_name text,
  p_phone text
)
returns public.station_riders
language plpgsql
security definer
set search_path = ''
as $$
declare
  rider_row public.station_riders%rowtype;
  next_rider_number integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 100
    or nullif(trim(p_phone), '') is null or length(trim(p_phone)) > 32
  then
    raise exception 'Enter a rider name (up to 100 characters) and phone number (up to 32 characters)';
  end if;

  perform 1
  from public.stations s
  where s.id = p_station_id
    and public.is_station_manager(s.id)
  for update;
  if not found then
    raise exception 'Station was not found or you are not its manager';
  end if;

  insert into public.station_rider_number_counters (station_id, last_rider_number)
  values (p_station_id, 0)
  on conflict (station_id) do nothing;
  update public.station_rider_number_counters
  set last_rider_number = last_rider_number + 1
  where station_id = p_station_id
  returning last_rider_number into next_rider_number;

  insert into public.station_riders (station_id, rider_number, name, phone)
  values (p_station_id, next_rider_number, trim(p_name), trim(p_phone))
  returning * into rider_row;
  return rider_row;
end;
$$;

create or replace function public.update_station_rider(
  p_rider_id uuid,
  p_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rider_row public.station_riders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;
  if nullif(trim(p_name), '') is null or length(trim(p_name)) > 100
    or nullif(trim(p_phone), '') is null or length(trim(p_phone)) > 32
  then
    raise exception 'Enter a rider name (up to 100 characters) and phone number (up to 32 characters)';
  end if;

  select * into rider_row
  from public.station_riders r
  where r.id = p_rider_id
  for update;
  if not found or not public.is_station_manager(rider_row.station_id) then
    raise exception 'Rider was not found for this station';
  end if;

  update public.station_riders
  set name = trim(p_name),
      phone = trim(p_phone),
      updated_at = now()
  where id = p_rider_id;
end;
$$;

create or replace function public.delete_station_rider(p_rider_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rider_row public.station_riders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select * into rider_row
  from public.station_riders r
  where r.id = p_rider_id
  for update;
  if not found or not public.is_station_manager(rider_row.station_id) then
    raise exception 'Rider was not found for this station';
  end if;

  delete from public.station_riders where id = p_rider_id;
end;
$$;

create or replace function public.assign_station_rider(
  p_order_id uuid,
  p_rider_id uuid,
  p_estimated_delivery_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.orders%rowtype;
  rider_row public.station_riders%rowtype;
  delivery_id_value uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required';
  end if;

  select * into order_row
  from public.orders o
  where o.id = p_order_id
  for update;
  if not found or not public.is_station_manager(order_row.station_id) then
    raise exception 'Order was not found for this station';
  end if;

  select * into rider_row
  from public.station_riders r
  where r.id = p_rider_id
    and r.station_id = order_row.station_id;
  if not found then
    raise exception 'Select a rider registered with this station';
  end if;

  delivery_id_value := public.assign_delivery_person(
    p_order_id,
    rider_row.name,
    rider_row.phone,
    p_estimated_delivery_at
  );
  update public.deliveries
  set rider_number = rider_row.rider_number
  where id = delivery_id_value;

  return delivery_id_value;
end;
$$;

revoke all privileges on public.station_riders from public, anon, authenticated;
revoke all privileges on public.station_rider_number_counters from public, anon, authenticated;
grant select on public.station_riders to authenticated;
revoke execute on function public.create_station_rider(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.update_station_rider(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.delete_station_rider(uuid) from public, anon, authenticated;
revoke execute on function public.assign_station_rider(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.create_station_rider(uuid, text, text) to authenticated;
grant execute on function public.update_station_rider(uuid, text, text) to authenticated;
grant execute on function public.delete_station_rider(uuid) to authenticated;
grant execute on function public.assign_station_rider(uuid, uuid, timestamptz) to authenticated;
