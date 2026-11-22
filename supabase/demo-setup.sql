-- Run after creating test users in Supabase Auth and after running migrations + npm run seed.
-- Replace every UUID placeholder with an actual Auth user UUID from Authentication → Users.

-- Example founder profile:
-- insert into public.profiles(id, full_name, role) values
-- ('00000000-0000-4000-a000-000000000001', 'Demo Founder', 'founder');

-- Example account manager profile:
-- insert into public.profiles(id, full_name, role) values
-- ('00000000-0000-4000-a000-000000000002', 'Demo Account Manager', 'account_manager');

-- Assign clients to that account manager:
-- update public.clients
-- set account_manager_id = '00000000-0000-4000-a000-000000000002'
-- where name in ('Northstar Foods', 'Mango Street');

-- Create an internal channel for Task A (one time):
-- insert into public.channels(name) values ('Internal Demo Channel');

-- Add a member to one channel for Task A tests:
-- insert into public.channel_members(channel_id, user_id)
-- select id, '00000000-0000-4000-a000-000000000003'
-- from public.channels where name = 'Internal Demo Channel';

-- Link a pod lead to their employee and pod:
-- update public.profiles
-- set role = 'pod_lead', pod_id = (select id from public.pods where name = 'Video Editing Alpha'),
--     employee_id = 'person-05'
-- where id = '00000000-0000-4000-a000-000000000004';

-- Link an ordinary team member to their employee record:
-- update public.profiles
-- set role = 'member', pod_id = (select pod_id from public.employees where id = 'person-01'),
--     employee_id = 'person-01'
-- where id = '00000000-0000-4000-a000-000000000005';
