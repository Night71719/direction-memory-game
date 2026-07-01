-- 我们的回忆宇宙：Supabase 数据库、权限、存储与 Realtime 配置
-- 在 Supabase 控制台的 SQL Editor 中完整运行一次即可。

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 1 and 24),
  color text not null default '#d95f7d',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.timeline_days (
  id uuid primary key default gen_random_uuid(),
  memory_date date not null unique,
  title text not null default '',
  cover_image_url text,
  cover_preview_data_url text,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.timeline_days
add column if not exists title text not null default '';
alter table public.timeline_days
add column if not exists cover_preview_data_url text;

create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  day_id uuid not null references public.timeline_days(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  content text not null default '',
  position_x double precision not null default 1100,
  position_y double precision not null default 750,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.memory_images (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  image_url text not null,
  preview_data_url text,
  storage_path text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  content text not null check (char_length(trim(content)) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  content text not null check (char_length(trim(content)) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.decorations (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  shape text not null default 'heart' check (shape in ('heart', 'star', 'poop', 'flower')),
  color text not null default '#d95f7d',
  size integer not null default 42 check (size between 20 and 90),
  position_x double precision not null,
  position_y double precision not null,
  image_url text not null,
  preview_data_url text,
  storage_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.special_dates (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.profiles(id) on delete cascade,
  author_name text not null,
  title text not null check (char_length(trim(title)) between 1 and 40),
  event_date date not null,
  event_type text not null default 'special'
    check (event_type in ('special', 'anniversary', 'birthday')),
  repeats_yearly boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.site_settings (
  id text primary key default 'home' check (id = 'home'),
  eyebrow text not null default 'LOVE MEMORY MAP'
    check (char_length(trim(eyebrow)) between 1 and 40),
  headline text not null default '把平凡日子，慢慢写成我们。'
    check (char_length(trim(headline)) between 1 and 80),
  description text not null default '沿着时间向前走，每一张照片、每一句话，都会在这里拥有自己的坐标。'
    check (char_length(trim(description)) between 1 and 180),
  default_decorations jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.site_settings
add column if not exists default_decorations jsonb not null default '{}'::jsonb;

alter table public.memory_images
add column if not exists preview_data_url text;
alter table public.decorations
add column if not exists preview_data_url text;

alter table public.profiles
add column if not exists current_page text not null default 'home';
alter table public.profiles
add column if not exists position_x double precision not null default 14;
alter table public.profiles
add column if not exists position_y double precision not null default 72;
alter table public.profiles
add column if not exists last_seen timestamptz;

create index if not exists memories_day_id_idx on public.memories(day_id);
create index if not exists memory_images_memory_id_idx on public.memory_images(memory_id);
create index if not exists comments_memory_id_idx on public.comments(memory_id);
create index if not exists chat_messages_created_at_idx on public.chat_messages(created_at desc);
create index if not exists decorations_created_at_idx on public.decorations(created_at);
create index if not exists special_dates_event_date_idx on public.special_dates(event_date);
create index if not exists profiles_last_seen_idx on public.profiles(last_seen);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists timeline_days_set_updated_at on public.timeline_days;
create trigger timeline_days_set_updated_at before update on public.timeline_days
for each row execute function public.set_updated_at();

drop trigger if exists memories_set_updated_at on public.memories;
create trigger memories_set_updated_at before update on public.memories
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.timeline_days enable row level security;
alter table public.memories enable row level security;
alter table public.memory_images enable row level security;
alter table public.comments enable row level security;
alter table public.chat_messages enable row level security;
alter table public.decorations enable row level security;
alter table public.special_dates enable row level security;
alter table public.site_settings enable row level security;

drop policy if exists "登录用户可查看资料" on public.profiles;
create policy "登录用户可查看资料" on public.profiles
for select to authenticated using (true);
drop policy if exists "用户可创建自己的资料" on public.profiles;
create policy "用户可创建自己的资料" on public.profiles
for insert to authenticated with check (id = auth.uid());
drop policy if exists "用户可修改自己的资料" on public.profiles;
create policy "用户可修改自己的资料" on public.profiles
for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "登录用户可查看日期" on public.timeline_days;
create policy "登录用户可查看日期" on public.timeline_days
for select to authenticated using (true);
drop policy if exists "登录用户可创建日期" on public.timeline_days;
create policy "登录用户可创建日期" on public.timeline_days
for insert to authenticated with check (true);
drop policy if exists "登录用户可更新日期封面" on public.timeline_days;
create policy "登录用户可更新日期封面" on public.timeline_days
for update to authenticated using (true) with check (true);

drop policy if exists "登录用户可查看回忆" on public.memories;
create policy "登录用户可查看回忆" on public.memories
for select to authenticated using (true);
drop policy if exists "用户可创建自己的回忆" on public.memories;
create policy "用户可创建自己的回忆" on public.memories
for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "用户可修改自己的回忆" on public.memories;
create policy "用户可修改自己的回忆" on public.memories
for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "用户可删除自己的回忆" on public.memories;
create policy "用户可删除自己的回忆" on public.memories
for delete to authenticated using (author_id = auth.uid());

drop policy if exists "登录用户可查看回忆图片" on public.memory_images;
create policy "登录用户可查看回忆图片" on public.memory_images
for select to authenticated using (true);
drop policy if exists "作者可添加回忆图片" on public.memory_images;
create policy "作者可添加回忆图片" on public.memory_images
for insert to authenticated with check (
  exists (
    select 1 from public.memories
    where memories.id = memory_images.memory_id
      and memories.author_id = auth.uid()
  )
);
drop policy if exists "作者可删除回忆图片记录" on public.memory_images;
create policy "作者可删除回忆图片记录" on public.memory_images
for delete to authenticated using (
  exists (
    select 1 from public.memories
    where memories.id = memory_images.memory_id
      and memories.author_id = auth.uid()
  )
);

drop policy if exists "登录用户可查看评论" on public.comments;
create policy "登录用户可查看评论" on public.comments
for select to authenticated using (true);
drop policy if exists "用户可创建自己的评论" on public.comments;
create policy "用户可创建自己的评论" on public.comments
for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "用户可删除自己的评论" on public.comments;
create policy "用户可删除自己的评论" on public.comments
for delete to authenticated using (author_id = auth.uid());

drop policy if exists "登录用户可查看聊天" on public.chat_messages;
create policy "登录用户可查看聊天" on public.chat_messages
for select to authenticated using (true);
drop policy if exists "用户可发送自己的消息" on public.chat_messages;
create policy "用户可发送自己的消息" on public.chat_messages
for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "用户可删除自己的消息" on public.chat_messages;
create policy "用户可删除自己的消息" on public.chat_messages
for delete to authenticated using (author_id = auth.uid());

drop policy if exists "登录用户可查看主页装饰" on public.decorations;
create policy "登录用户可查看主页装饰" on public.decorations
for select to authenticated using (true);
drop policy if exists "用户可创建自己的主页装饰" on public.decorations;
create policy "用户可创建自己的主页装饰" on public.decorations
for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "用户可修改自己的主页装饰" on public.decorations;
create policy "用户可修改自己的主页装饰" on public.decorations
for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "用户可删除自己的主页装饰" on public.decorations;
create policy "用户可删除自己的主页装饰" on public.decorations
for delete to authenticated using (author_id = auth.uid());

drop policy if exists "登录用户可查看特殊日期" on public.special_dates;
create policy "登录用户可查看特殊日期" on public.special_dates
for select to authenticated using (true);
drop policy if exists "用户可创建自己的特殊日期" on public.special_dates;
create policy "用户可创建自己的特殊日期" on public.special_dates
for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "用户可删除自己的特殊日期" on public.special_dates;
create policy "用户可删除自己的特殊日期" on public.special_dates
for delete to authenticated using (author_id = auth.uid());

-- 创建公开图片桶。公开仅表示持有图片地址即可读取，上传与删除仍受下方策略保护。
drop policy if exists "登录用户可查看首页文字" on public.site_settings;
create policy "登录用户可查看首页文字" on public.site_settings
for select to authenticated using (true);
drop policy if exists "登录用户可创建首页文字" on public.site_settings;
create policy "登录用户可创建首页文字" on public.site_settings
for insert to authenticated with check (id = 'home');
drop policy if exists "登录用户可修改首页文字" on public.site_settings;
create policy "登录用户可修改首页文字" on public.site_settings
for update to authenticated using (id = 'home') with check (id = 'home');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'memory-images',
  'memory-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "所有人可读取回忆图片" on storage.objects;
create policy "所有人可读取回忆图片" on storage.objects
for select to public using (bucket_id = 'memory-images');

drop policy if exists "登录用户可上传到自己的目录" on storage.objects;
create policy "登录用户可上传到自己的目录" on storage.objects
for insert to authenticated with check (
  bucket_id = 'memory-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "用户可修改自己的图片" on storage.objects;
create policy "用户可修改自己的图片" on storage.objects
for update to authenticated using (
  bucket_id = 'memory-images'
  and owner_id = auth.uid()::text
) with check (
  bucket_id = 'memory-images'
  and owner_id = auth.uid()::text
);

drop policy if exists "用户可删除自己的图片" on storage.objects;
create policy "用户可删除自己的图片" on storage.objects
for delete to authenticated using (
  bucket_id = 'memory-images'
  and owner_id = auth.uid()::text
);

-- 将需要实时刷新的表加入 Realtime。重复执行脚本时不会报错。
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'timeline_days', 'memories', 'memory_images', 'comments', 'chat_messages', 'decorations', 'special_dates', 'site_settings'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end $$;
