-- יומן מסחר — Supabase Schema
-- הרץ קוד זה ב-SQL Editor של Supabase

create table if not exists journal_data (
  user_id    text        not null,
  data_key   text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, data_key)
);

alter table journal_data enable row level security;

-- מדיניות גישה: כל אחד עם ה-anon key יכול לקרוא ולכתוב
-- (מתאים לאפליקציה אישית — רק אתה יודע את ה-user_id שלך)
create policy "allow_all" on journal_data
  for all
  using (true)
  with check (true);
