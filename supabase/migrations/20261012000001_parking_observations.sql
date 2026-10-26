-- Crossmetric commuter: one-tap parking observations.
-- Short-lived reports ("opening", "full", "meter_active") for a parking place.
-- No coordinates, names, accounts or IP addresses: only a salted hash of an
-- anonymous device key, used for rate limits, undo and one-report-per-person
-- aggregation. 'held' rows (suspicious bursts) are kept out of availability
-- until reviewed. Rows older than two hours are deleted by the application.
-- Reports never change parking rules.

create table if not exists parking_observations (
  id             uuid primary key default gen_random_uuid(),
  place_id       text not null check (char_length(place_id) <= 40),
  kind           text not null check (kind in ('opening', 'full', 'meter_active')),
  reporter_hash  text not null check (char_length(reporter_hash) = 32),
  observed_at    timestamptz not null default now(),
  verification   text not null default 'manual' check (verification in ('located', 'manual', 'held'))
);

create index if not exists parking_observations_time_idx on parking_observations (observed_at desc);
create index if not exists parking_observations_place_idx on parking_observations (place_id, observed_at desc);

alter table parking_observations enable row level security;
