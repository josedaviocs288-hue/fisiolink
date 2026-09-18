-- FisioLink - atualização de perfil, foto e dados profissionais.
-- Execute TODO este arquivo no Supabase > SQL Editor > New query > Run.
-- Esta atualização NÃO apaga dados existentes.

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists city text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles add column if not exists specialty text;
alter table public.profiles add column if not exists crefito text;
alter table public.profiles add column if not exists clinic text;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- Garante que cada usuário autenticado possa editar somente o próprio perfil.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles for select to authenticated
using (true);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

-- Fotos de perfil: bucket privado, acessível apenas para usuários autenticados.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fisiolink-avatars',
  'fisiolink-avatars',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars_read_authenticated" on storage.objects;
create policy "avatars_read_authenticated"
on storage.objects for select to authenticated
using (bucket_id = 'fisiolink-avatars');

drop policy if exists "avatars_insert_own_folder" on storage.objects;
create policy "avatars_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fisiolink-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_update_own_folder" on storage.objects;
create policy "avatars_update_own_folder"
on storage.objects for update to authenticated
using (
  bucket_id = 'fisiolink-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'fisiolink-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "avatars_delete_own_folder" on storage.objects;
create policy "avatars_delete_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'fisiolink-avatars'
  and (storage.foldername(name))[1] = auth.uid()::text
);

select 'FisioLink atualizado: perfil, foto, preferências e dados profissionais prontos.' as resultado;
