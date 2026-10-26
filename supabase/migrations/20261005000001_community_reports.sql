-- CrossMetric 2.0: community reports.
-- Anonymous, location-based reports of walking and biking issues. No personal
-- data: no accounts, names, emails or IP addresses are stored. Reports are
-- community information, never official data; "confirmations" and
-- "resolved_votes" are counts of other visitors' votes, not verification.

create table if not exists community_reports (
  id              uuid primary key default gen_random_uuid(),
  category        text not null check (category in (
                    'missing_sidewalk', 'damaged_sidewalk', 'difficult_crossing', 'blocked_path',
                    'poor_visibility', 'construction', 'bike_lane', 'bus_stop', 'other')),
  description     text check (description is null or char_length(description) <= 280),
  geom            geography(Point, 4326) not null,
  location_label  text check (location_label is null or char_length(location_label) <= 120),
  created_at      timestamptz not null default now(),
  confirmations   integer not null default 0 check (confirmations >= 0),
  resolved_votes  integer not null default 0 check (resolved_votes >= 0)
);

create index if not exists community_reports_geom_idx on community_reports using gist (geom);
create index if not exists community_reports_created_idx on community_reports (created_at desc);

-- The web server connects with the service connection string; the public anon
-- role gets no direct access.
alter table community_reports enable row level security;
