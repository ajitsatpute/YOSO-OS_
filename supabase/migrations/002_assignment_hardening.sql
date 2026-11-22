-- Assignment-specific refinements: employee identity, pod boundaries and score persistence.
alter table public.profiles add column if not exists employee_id text references public.employees(id);
alter table public.deliverables add column if not exists pod_id uuid references public.pods(id);
create index if not exists deliverables_pod_week_idx on public.deliverables(pod_id,week,due_date);
create or replace function public.can_read_channel(cid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.channel_members cm where cm.channel_id=cid and cm.user_id=auth.uid())
 or exists(select 1 from public.channels ch join public.clients c on c.id=ch.client_id where ch.id=cid and c.account_manager_id=auth.uid())
$$;
-- Founder can inspect scores and all clients, but is not automatically a WhatsApp/channel member.
create or replace function public.can_read_chat(cid uuid, clientid uuid) returns boolean language sql stable security definer set search_path=public as $$
 select public.can_read_channel(cid) or exists(select 1 from public.clients c where c.id=clientid and c.account_manager_id=auth.uid())
$$;
drop policy if exists chat_read on public.chat_messages;
create policy chat_read on public.chat_messages for select using(public.can_read_chat(channel_id,client_id) and deleted_at is null);
drop policy if exists chat_insert on public.chat_messages;
create policy chat_insert on public.chat_messages for insert with check(public.can_read_channel(channel_id) and sender_id=auth.uid());
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select using(public.is_founder() or id=(select employee_id from public.profiles where id=auth.uid()) or pod_id=(select pod_id from public.profiles where id=auth.uid() and role='pod_lead'));
drop policy if exists deliverables_read on public.deliverables;
create policy deliverables_read on public.deliverables for select using(public.is_founder() or assigned_to=(select employee_id from public.profiles where id=auth.uid()) or (public.current_role()='pod_lead' and pod_id=(select pod_id from public.profiles where id=auth.uid())) or public.can_read_client(client_id));
drop policy if exists deliverables_lead_write on public.deliverables;
create policy deliverables_lead_write on public.deliverables for update using(public.is_founder() or (public.current_role()='pod_lead' and pod_id=(select pod_id from public.profiles where id=auth.uid()))) with check(public.is_founder() or (public.current_role()='pod_lead' and pod_id=(select pod_id from public.profiles where id=auth.uid())));
create policy health_insert on public.client_health_scores for insert with check(public.can_read_client(client_id));
create policy health_update on public.client_health_scores for update using(public.can_read_client(client_id)) with check(public.can_read_client(client_id));
create policy alert_insert on public.health_alerts for insert with check(account_manager_id=auth.uid() or public.is_founder());
-- Supabase Realtime publication (safe to run when the tables are not already published).
do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='chat_messages') then alter publication supabase_realtime add table public.chat_messages; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='message_reactions') then alter publication supabase_realtime add table public.message_reactions; end if;
end $$;
create or replace function public.current_pod_id() returns uuid language sql stable security definer set search_path=public as $$ select pod_id from public.profiles where id=auth.uid() $$;
create or replace function public.current_employee_id() returns text language sql stable security definer set search_path=public as $$ select employee_id from public.profiles where id=auth.uid() $$;
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using(id=auth.uid() or public.is_founder() or (public.current_role()='pod_lead' and pod_id=public.current_pod_id()));
drop policy if exists pods_read on public.pods;
create policy pods_read on public.pods for select using(public.is_founder() or id=public.current_pod_id());
drop policy if exists employees_read on public.employees;
create policy employees_read on public.employees for select using(public.is_founder() or id=public.current_employee_id() or pod_id=public.current_pod_id() and public.current_role()='pod_lead');
drop policy if exists deliverables_read on public.deliverables;
create policy deliverables_read on public.deliverables for select using(public.is_founder() or assigned_to=public.current_employee_id() or (public.current_role()='pod_lead' and pod_id=public.current_pod_id()) or public.can_read_client(client_id));
drop policy if exists deliverables_lead_write on public.deliverables;
create policy deliverables_lead_write on public.deliverables for update using(public.is_founder() or (public.current_role()='pod_lead' and pod_id=public.current_pod_id())) with check(public.is_founder() or (public.current_role()='pod_lead' and pod_id=public.current_pod_id()));
alter table public.deliverables add column if not exists review_passes int not null default 4 check(review_passes between 0 and 4);
alter table public.deliverables add column if not exists client_revision_hours numeric not null default 0 check(client_revision_hours>=0);
