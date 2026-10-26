-- Crossmetric internal research pipeline (not student-facing).
-- research_feedback: first-party feedback, minimized before insert, kept 30 days.
--   Only a hash of the submitter's deletion code is stored; no accounts, names,
--   emails or IP addresses.
-- research_runs: the last few bounded batch reports and reviewable drafts.
-- research_reviews: a reviewer's decision per cluster. Drafts never change
--   code, parking rules or anything students see.

create table if not exists research_feedback (
  id             uuid primary key default gen_random_uuid(),
  campus         text not null check (campus in ('GT', 'UGA', 'BOTH', 'UNKNOWN')),
  text           text not null check (char_length(text) <= 1200),
  posted_at      timestamptz not null,
  created_at     timestamptz not null default now(),
  deletion_hash  text not null check (char_length(deletion_hash) = 64),
  expires_at     timestamptz not null
);
create index if not exists research_feedback_posted_idx on research_feedback (posted_at desc);
create index if not exists research_feedback_deletion_idx on research_feedback (deletion_hash);

create table if not exists research_runs (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  report      jsonb not null,
  drafts      jsonb not null
);

create table if not exists research_reviews (
  cluster_id   text primary key,
  decision     text not null check (decision in ('accept', 'merge', 'reject', 'needs_evidence')),
  note         text not null default '' check (char_length(note) <= 500),
  reviewed_at  timestamptz not null default now()
);

alter table research_feedback enable row level security;
alter table research_runs enable row level security;
alter table research_reviews enable row level security;
