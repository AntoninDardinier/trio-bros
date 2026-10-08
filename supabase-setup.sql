-- ============================================================
--  Nos Stickers — à coller UNE FOIS dans Supabase :
--  SQL Editor → New query → coller → Run
-- ============================================================

-- 1. La table des stickers
create table if not exists public.pins (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  created_by  uuid not null default auth.uid() references auth.users(id) on delete cascade,
  author_name text,
  lat         double precision not null,
  lng         double precision not null,
  note        text,
  place       text,
  country     text,
  photo_path  text,
  stuck_on    date not null default current_date
);

-- 2. Sécurité : seuls les comptes connectés voient la carte,
--    chacun ne peut supprimer que ses propres stickers
alter table public.pins enable row level security;

drop policy if exists "pins lecture" on public.pins;
drop policy if exists "pins ajout" on public.pins;
drop policy if exists "pins modif" on public.pins;
drop policy if exists "pins suppression" on public.pins;

create policy "pins lecture"     on public.pins for select to authenticated using (true);
create policy "pins ajout"       on public.pins for insert to authenticated with check (created_by = auth.uid());
create policy "pins modif"       on public.pins for update to authenticated using (created_by = auth.uid());
create policy "pins suppression" on public.pins for delete to authenticated using (created_by = auth.uid());

-- 3. Mise à jour en direct (un sticker posé apparaît chez les autres)
do $$
begin
  alter publication supabase_realtime add table public.pins;
exception when duplicate_object then null;
end $$;

-- 4. Le stockage des photos (privé : visible seulement par vous trois)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

drop policy if exists "photos lecture" on storage.objects;
drop policy if exists "photos ajout" on storage.objects;
drop policy if exists "photos suppression" on storage.objects;

create policy "photos lecture" on storage.objects for select to authenticated
  using (bucket_id = 'photos');
create policy "photos ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos');
create policy "photos suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and owner_id = auth.uid()::text);
