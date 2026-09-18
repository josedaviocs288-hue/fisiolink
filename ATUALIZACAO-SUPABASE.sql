-- FisioLink - atualização para mensagens, arquivos, áudio, agenda e chamadas WebRTC.
-- Rode TODO este arquivo uma única vez no Supabase > SQL Editor > New query > Run.
-- Ele NÃO apaga as tabelas/vídeos/progresso que você já possui.

create extension if not exists pgcrypto;

-- =========================
-- MENSAGENS
-- =========================
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '',
  message_type text not null default 'text' check (message_type in ('text','file','audio')),
  attachment_path text,
  attachment_name text,
  created_at timestamptz not null default now()
);

create index if not exists messages_sender_receiver_created_idx
  on public.messages (sender_id, receiver_id, created_at);
create index if not exists messages_receiver_created_idx
  on public.messages (receiver_id, created_at desc);

alter table public.messages enable row level security;

drop policy if exists "messages_select_participants" on public.messages;
create policy "messages_select_participants"
on public.messages for select to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "messages_insert_sender" on public.messages;
create policy "messages_insert_sender"
on public.messages for insert to authenticated
with check (auth.uid() = sender_id and sender_id <> receiver_id);

drop policy if exists "messages_update_sender" on public.messages;
create policy "messages_update_sender"
on public.messages for update to authenticated
using (auth.uid() = sender_id)
with check (auth.uid() = sender_id);

drop policy if exists "messages_delete_sender" on public.messages;
create policy "messages_delete_sender"
on public.messages for delete to authenticated
using (auth.uid() = sender_id);

-- =========================
-- AGENDA
-- =========================
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.profiles(id) on delete cascade,
  therapist_id uuid not null references public.profiles(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete cascade,
  scheduled_at timestamptz not null,
  mode text not null default 'online' check (mode in ('online','presencial')),
  note text not null default '',
  status text not null default 'pendente' check (status in ('pendente','confirmada','cancelada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists appointments_patient_time_idx on public.appointments (patient_id, scheduled_at);
create index if not exists appointments_therapist_time_idx on public.appointments (therapist_id, scheduled_at);

alter table public.appointments enable row level security;

drop policy if exists "appointments_select_participants" on public.appointments;
create policy "appointments_select_participants"
on public.appointments for select to authenticated
using (auth.uid() = patient_id or auth.uid() = therapist_id);

drop policy if exists "appointments_insert_participant" on public.appointments;
create policy "appointments_insert_participant"
on public.appointments for insert to authenticated
with check (
  requested_by = auth.uid()
  and (patient_id = auth.uid() or therapist_id = auth.uid())
  and patient_id <> therapist_id
);

drop policy if exists "appointments_update_participants" on public.appointments;
create policy "appointments_update_participants"
on public.appointments for update to authenticated
using (auth.uid() = patient_id or auth.uid() = therapist_id)
with check (auth.uid() = patient_id or auth.uid() = therapist_id);

-- =========================
-- CHAMADAS WEBRTC / SINALIZAÇÃO
-- =========================
create table if not exists public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  call_type text not null check (call_type in ('voice','video')),
  status text not null default 'preparing' check (status in ('preparing','ringing','accepted','declined','ended')),
  offer jsonb,
  answer jsonb,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create index if not exists call_sessions_callee_status_idx on public.call_sessions (callee_id, status, created_at desc);

alter table public.call_sessions enable row level security;

drop policy if exists "calls_select_participants" on public.call_sessions;
create policy "calls_select_participants"
on public.call_sessions for select to authenticated
using (auth.uid() = caller_id or auth.uid() = callee_id);

drop policy if exists "calls_insert_caller" on public.call_sessions;
create policy "calls_insert_caller"
on public.call_sessions for insert to authenticated
with check (auth.uid() = caller_id and caller_id <> callee_id);

drop policy if exists "calls_update_participants" on public.call_sessions;
create policy "calls_update_participants"
on public.call_sessions for update to authenticated
using (auth.uid() = caller_id or auth.uid() = callee_id)
with check (auth.uid() = caller_id or auth.uid() = callee_id);

create table if not exists public.ice_candidates (
  id bigint generated by default as identity primary key,
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  candidate jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists ice_candidates_call_idx on public.ice_candidates (call_id, created_at);

alter table public.ice_candidates enable row level security;

drop policy if exists "ice_select_call_participants" on public.ice_candidates;
create policy "ice_select_call_participants"
on public.ice_candidates for select to authenticated
using (
  exists (
    select 1 from public.call_sessions c
    where c.id = call_id
      and (c.caller_id = auth.uid() or c.callee_id = auth.uid())
  )
);

drop policy if exists "ice_insert_self_participant" on public.ice_candidates;
create policy "ice_insert_self_participant"
on public.ice_candidates for insert to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.call_sessions c
    where c.id = call_id
      and (c.caller_id = auth.uid() or c.callee_id = auth.uid())
  )
);

-- =========================
-- ARQUIVOS E ÁUDIOS DO CHAT
-- =========================
insert into storage.buckets (id, name, public, file_size_limit)
values ('fisiolink-chat','fisiolink-chat',false,20971520)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit;

drop policy if exists "chat_files_read_authenticated" on storage.objects;
create policy "chat_files_read_authenticated"
on storage.objects for select to authenticated
using (bucket_id = 'fisiolink-chat');

drop policy if exists "chat_files_insert_own_folder" on storage.objects;
create policy "chat_files_insert_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fisiolink-chat'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "chat_files_delete_own_folder" on storage.objects;
create policy "chat_files_delete_own_folder"
on storage.objects for delete to authenticated
using (
  bucket_id = 'fisiolink-chat'
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- =========================
-- REALTIME
-- =========================
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'appointments') then
    alter publication supabase_realtime add table public.appointments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_sessions') then
    alter publication supabase_realtime add table public.call_sessions;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ice_candidates') then
    alter publication supabase_realtime add table public.ice_candidates;
  end if;
end $$;

-- Confirmação visual no SQL Editor
select 'FisioLink atualizado: mensagens, agenda, arquivos, áudio e chamadas estão prontos.' as resultado;
