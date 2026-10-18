-- GroupHub schema (PostgreSQL / Supabase).
-- The server runs this automatically on startup (it is idempotent). You can also paste it into
-- Supabase > SQL Editor and run it once by hand.

create table if not exists groups (
  id          text primary key,
  name        text not null,
  cat         text not null,
  country     text not null,
  lang        text not null,
  plat        text not null check (plat in ('wa', 'tg')),
  link        text not null,
  link_key    text not null unique,            -- normalised invite code, used to reject duplicates
  description text not null default '',
  members     integer check (members is null or members >= 0),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  featured    boolean not null default false,
  sample      boolean not null default false,
  submitter   text,                            -- salted hash of the submitter IP (not the IP itself)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- Profile picture metadata (added later; ALTER ... IF NOT EXISTS migrates existing databases on startup).
alter table groups add column if not exists image_version    integer;     -- bumps on every new picture; null = no picture
alter table groups add column if not exists image_status     text;        -- 'ok' | 'none' (platform has no picture) | 'error'
alter table groups add column if not exists image_error      text;
alter table groups add column if not exists image_checked_at timestamptz;

create index if not exists groups_status_created_idx on groups (status, created_at desc);
create index if not exists groups_cat_idx on groups (cat);

create table if not exists reports (
  id          text primary key,
  group_id    text not null references groups (id) on delete cascade,
  reason      text not null,
  details     text not null default '',
  reporter    text,                            -- salted hash of the reporter IP
  created_at  timestamptz not null default now()
);
create index if not exists reports_group_idx on reports (group_id, created_at desc);

-- Our own copy of each group's profile picture (platform image URLs expire). ~256x256 webp, a few KB each.
create table if not exists group_images (
  group_id     text primary key references groups (id) on delete cascade,
  content_type text not null,
  data         bytea not null,
  version      integer not null,
  updated_at   timestamptz not null default now()
);

-- Supabase exposes tables in the public schema through its auto-generated REST API.
-- Turning on Row Level Security with NO policies blocks that API (anon/authenticated keys)
-- while the GroupHub server, which connects as the database owner, keeps full access.
alter table groups enable row level security;
alter table reports enable row level security;
alter table group_images enable row level security;
