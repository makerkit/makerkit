create table users (
  id uuid references auth.users not null primary key,
  photo_url text,
  display_name text,
  onboarded bool not null,
  created_at timestamptz not null default now()
);

create table tasks (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users,
  name text not null,
  done bool not null,
  due_date timestamptz not null
);

alter table users enable row level security;
alter table tasks enable row level security;

create policy "Users can create their own tasks." on tasks for insert with check (auth.uid() = user_id);
create policy "Users can read their own tasks." on tasks for select using (auth.uid() = user_id);
create policy "Users can update their own tasks." on tasks for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own tasks." on tasks for delete using (auth.uid() = user_id);
create policy "Users can read their own profile." on users for select using (auth.uid() = id);