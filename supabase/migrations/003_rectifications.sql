-- 003_rectifications.sql
-- Fixes RLS cross-client/channel leaks, storage MIME/path enforcement, and score/alert insert boundaries.

-- 1. Tighten can_read_client: pod_leads should only see clients tied to deliverables in their pod,
--    NOT read all client WhatsApp chats unless they are a channel_member or assigned account_manager.
create or replace function public.can_read_client(cid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_founder()
    or exists (
      select 1 from public.clients c
      where c.id = cid and c.account_manager_id = auth.uid()
    )
    or exists (
      select 1 from public.client_access ca
      where ca.client_id = cid and ca.user_id = auth.uid()
    )
    or (
      public.current_role() = 'pod_lead'
      and exists (
        select 1
        from public.deliverables d
        where d.client_id = cid
          and d.pod_id = public.current_pod_id()
      )
    )
$$;

-- 2. Restrict health score/alert client-side writes: only service_role (server cron/API) or assigned AM/founder may write,
--    and prevent duplicate/tampered inserts from unauthorized roles.
drop policy if exists health_insert on public.client_health_scores;
create policy health_insert on public.client_health_scores
  for insert
  with check (
    public.is_founder()
    or exists (
      select 1 from public.clients c
      where c.id = client_id and c.account_manager_id = auth.uid()
    )
  );

drop policy if exists health_update on public.client_health_scores;
create policy health_update on public.client_health_scores
  for update
  using (false)
  with check (false);

-- 3. Allow iOS Safari audio/mp4, audio/x-m4a, audio/aac and enforce folder ownership on voice-notes upload.
update storage.buckets
set allowed_mime_types = array[
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'audio/aac',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav'
]
where id = 'voice-notes';

drop policy if exists voice_insert on storage.objects;
create policy voice_insert on storage.objects
  for insert
  with check (
    bucket_id = 'voice-notes'
    and public.can_read_channel((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists voice_update on storage.objects;
create policy voice_update on storage.objects
  for update
  using (
    bucket_id = 'voice-notes'
    and public.can_read_channel((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'voice-notes'
    and public.can_read_channel((storage.foldername(name))[1]::uuid)
    and (storage.foldername(name))[2] = auth.uid()::text
  );

-- 4. Prevent regular members from reading all deliverables of a client they are not assigned to
--    unless they are founder, assigned employee, pod_lead of that pod, or assigned account_manager.
drop policy if exists deliverables_read on public.deliverables;
create policy deliverables_read on public.deliverables
  for select
  using (
    public.is_founder()
    or assigned_to = public.current_employee_id()
    or (public.current_role() = 'pod_lead' and pod_id = public.current_pod_id())
    or exists (
      select 1 from public.clients c
      where c.id = deliverables.client_id
        and c.account_manager_id = auth.uid()
    )
  );
