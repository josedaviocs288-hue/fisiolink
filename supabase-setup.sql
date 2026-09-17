-- FisioLink - banco + segurança + storage
-- Execute TODO este arquivo no Supabase > SQL Editor > New query > Run.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null check (role in ('patient','therapist')),
  created_at timestamptz not null default now()
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  therapist_name text not null,
  title text not null,
  description text default '',
  category text not null,
  body_area text default '',
  level text default 'Leve',
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 180),
  storage_path text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.progress (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  completed boolean not null default true,
  watched_at timestamptz not null default now(),
  unique(patient_id, video_id)
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
    case when new.raw_user_meta_data->>'role' = 'therapist' then 'therapist' else 'patient' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.videos enable row level security;
alter table public.progress enable row level security;

-- Perfis: usuários autenticados podem visualizar nomes/roles, e cada um atualiza só o próprio perfil.
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Vídeos: qualquer usuário autenticado vê ativos. Fisioterapeuta vê também os próprios ocultos.
drop policy if exists "videos_select_authenticated" on public.videos;
create policy "videos_select_authenticated" on public.videos for select to authenticated
using (active = true or therapist_id = auth.uid());

drop policy if exists "videos_insert_therapist" on public.videos;
create policy "videos_insert_therapist" on public.videos for insert to authenticated
with check (
  therapist_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'therapist')
);

drop policy if exists "videos_update_own" on public.videos;
create policy "videos_update_own" on public.videos for update to authenticated
using (therapist_id = auth.uid()) with check (therapist_id = auth.uid());

drop policy if exists "videos_delete_own" on public.videos;
create policy "videos_delete_own" on public.videos for delete to authenticated
using (therapist_id = auth.uid());

-- Progresso: paciente vê e altera o próprio progresso; fisioterapeuta pode contar conclusões dos próprios vídeos.
drop policy if exists "progress_select_patient_or_therapist" on public.progress;
create policy "progress_select_patient_or_therapist" on public.progress for select to authenticated
using (
  patient_id = auth.uid()
  or exists (select 1 from public.videos v where v.id = video_id and v.therapist_id = auth.uid())
);

drop policy if exists "progress_insert_own_patient" on public.progress;
create policy "progress_insert_own_patient" on public.progress for insert to authenticated
with check (
  patient_id = auth.uid()
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'patient')
);

drop policy if exists "progress_update_own_patient" on public.progress;
create policy "progress_update_own_patient" on public.progress for update to authenticated
using (patient_id = auth.uid()) with check (patient_id = auth.uid());

-- Bucket privado de vídeos. URLs são temporárias (signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fisiolink-videos','fisiolink-videos',false,209715200,array['video/mp4','video/webm'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage: autenticados podem ler; somente fisioterapeutas enviam para sua própria pasta.
drop policy if exists "video_files_read_authenticated" on storage.objects;
create policy "video_files_read_authenticated" on storage.objects for select to authenticated
using (bucket_id = 'fisiolink-videos');

drop policy if exists "video_files_insert_therapist" on storage.objects;
create policy "video_files_insert_therapist" on storage.objects for insert to authenticated
with check (
  bucket_id = 'fisiolink-videos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'therapist')
);

drop policy if exists "video_files_update_own" on storage.objects;
create policy "video_files_update_own" on storage.objects for update to authenticated
using (bucket_id = 'fisiolink-videos' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'fisiolink-videos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "video_files_delete_own" on storage.objects;
create policy "video_files_delete_own" on storage.objects for delete to authenticated
using (bucket_id = 'fisiolink-videos' and (storage.foldername(name))[1] = auth.uid()::text);
