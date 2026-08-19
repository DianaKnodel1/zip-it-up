create type public.backup_mode as enum ('full', 'db', 'manual');

create table public.backup_status (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz default now(),
    host text not null,
    archive text not null,
    size text not null,
    mode public.backup_mode default 'full',
    status text not null,
    backup_host text not null,
    duration_ms integer
);

grant select on public.backup_status to authenticated;
grant all on public.backup_status to service_role;
grant all on public.backup_status to postgres;

alter table public.backup_status enable row level security;

create policy "Admins can read backup status"
on public.backup_status
for select
to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy "Service role can manage backup status"
on public.backup_status
for all
to service_role
using (true)
with check (true);
