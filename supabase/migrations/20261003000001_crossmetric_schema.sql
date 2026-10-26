-- CrossMetric schema (Supabase PostgreSQL + PostGIS)
--
-- Geography columns use SRID 4326 (WGS84). Distances computed with
-- geography are true meters on the ellipsoid, which matches the pipeline's
-- projected-meter math within centimeters at school-area scale.

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Provenance
-- ---------------------------------------------------------------------------

create table data_sources (
  id            text primary key,
  title         text not null,
  publisher     text not null,
  url           text not null check (url ~ '^https://'),
  role          text not null,
  records       integer check (records is null or records >= 0),
  retrieved_on  date
);

create table model_versions (
  version     text primary key check (version ~ '^\d+\.\d+\.\d+$'),
  released    date not null,
  definition  jsonb not null,           -- the full crossmetric-model.json
  created_at  timestamptz not null default now()
);

create table pipeline_runs (
  id             bigserial primary key,
  generated_at   timestamptz not null,
  data_snapshot  date not null,
  window_start   date not null,
  window_end     date not null check (window_end >= window_start),
  model_version  text not null references model_versions(version),
  meta           jsonb not null,        -- the published meta.json (quality report)
  unique (generated_at)
);

-- ---------------------------------------------------------------------------
-- Schools (NCES)
-- ---------------------------------------------------------------------------

create table schools (
  id             char(12) primary key check (id ~ '^\d{12}$'),   -- NCESSCH
  name           text not null check (length(name) > 0),
  district       text,
  district_id    text,
  city           text,
  county         text,
  street         text,
  zip            text,
  level          text,
  grade_low      text,
  grade_high     text,
  school_type    text,
  school_year    text,
  candidates_800 integer not null default 0 check (candidates_800 >= 0),
  crashes_1200   integer not null default 0 check (crashes_1200 >= 0),
  quality        jsonb not null default '{}'::jsonb,              -- crash association counts near the school
  geom           geography(Point, 4326) not null
);
create index schools_geom_gix on schools using gist (geom);
create index schools_name_trgm on schools using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Road network and traffic (GDOT)
-- ---------------------------------------------------------------------------

create table road_segments (
  id             text primary key check (id ~ '^r\d{6}$'),
  route_id       text not null check (length(route_id) = 16),
  route_key      text not null,
  direction      text not null check (direction in ('INC', 'DEC')),
  function_type  text not null,
  system_code    text not null check (system_code in ('1', '2')),
  f_system       smallint check (f_system between 1 and 7),
  lanes          real check (lanes is null or lanes > 0),
  role           text not null check (role in ('surface', 'access_controlled', 'ramp', 'connector')),
  begin_mp       double precision,
  end_mp         double precision,
  geom           geography(LineString, 4326) not null
);
create index road_segments_geom_gix on road_segments using gist (geom);
create index road_segments_route_key_idx on road_segments (route_key);

create table traffic_counts (
  id           bigserial primary key,
  route_id     text not null,
  aadt         integer not null check (aadt > 0),        -- missing AADT is never stored as 0
  aadt_year    smallint not null check (aadt_year between 1990 and 2100),
  future_aadt  integer check (future_aadt is null or future_aadt > 0),
  source_id    text not null references data_sources(id),
  geom         geography(Geometry, 4326) not null
);
create index traffic_counts_geom_gix on traffic_counts using gist (geom);
create index traffic_counts_route_idx on traffic_counts (route_id);

-- ---------------------------------------------------------------------------
-- Candidate locations (intersections and mid-block units)
-- ---------------------------------------------------------------------------

create table candidate_locations (
  id                 text primary key check (id ~ '^[IS][0-9a-f]{10}$'),
  kind               text not null check (kind in ('intersection', 'segment')),
  name               text not null,
  context            text,
  roads              text[] not null check (cardinality(roads) >= 1),
  route_keys         text[] not null,
  functional_class   smallint not null check (functional_class between 1 and 7),
  lanes              real check (lanes is null or lanes > 0),
  length_m           real check (length_m is null or length_m > 0),
  legs               smallint check (legs is null or legs >= 3),
  signalized         boolean check (signalized is null or signalized),  -- true, or null = no GDOT record
  aadt               integer check (aadt is null or aadt > 0),
  aadt_year          smallint,
  aadt_status        text not null check (aadt_status in ('measured', 'partial', 'unavailable')),
  aadt_roads_counted smallint not null check (aadt_roads_counted >= 0),
  aadt_roads_total   smallint not null check (aadt_roads_total >= aadt_roads_counted),
  geom               geography(Geometry, 4326) not null,
  constraint candidate_geometry_matches_kind check (
    (kind = 'intersection' and GeometryType(geom::geometry) = 'POINT') or
    (kind = 'segment' and GeometryType(geom::geometry) = 'LINESTRING')
  ),
  constraint candidate_aadt_consistent check ((aadt is null) = (aadt_status = 'unavailable'))
);
create index candidate_locations_geom_gix on candidate_locations using gist (geom);

create table school_candidates (
  school_id     char(12) not null references schools(id) on delete cascade,
  candidate_id  text not null references candidate_locations(id) on delete cascade,
  distance_m    real not null check (distance_m >= 0 and distance_m <= 1200),
  primary key (school_id, candidate_id)
);
create index school_candidates_candidate_idx on school_candidates (candidate_id);

-- ---------------------------------------------------------------------------
-- Crashes (GDOT GEARS via GeoPI)
-- ---------------------------------------------------------------------------

create table crashes (
  crash_id            text primary key,                  -- GEARS accident id
  source_oid          bigint not null unique,
  crash_date          date not null,
  injuries            smallint check (injuries is null or injuries >= 0),
  fatalities          smallint check (fatalities is null or fatalities >= 0),
  vehicles            smallint check (vehicles is null or vehicles >= 0),
  injury_or_fatal     boolean not null,
  fatal               boolean not null,
  pedestrian          boolean not null,
  bicyclist           boolean not null,
  light               text not null check (light in ('daylight', 'dawn', 'dusk', 'dark_lighted', 'dark_unlighted', 'unknown')),
  low_light           boolean not null,
  collision_type      text,
  location_of_impact  text,
  county              text,
  candidate_id        text references candidate_locations(id) on delete set null,
  association         text not null check (association in
                        ('assigned', 'off_network', 'limited_access', 'ramp', 'no_candidate', 'outside_school_areas')),
  geom                geography(Point, 4326) not null,
  constraint crash_assignment_consistent check ((association = 'assigned') = (candidate_id is not null)),
  constraint crash_fatal_implies_injury check (not fatal or injury_or_fatal)
);
create index crashes_geom_gix on crashes using gist (geom);
create index crashes_candidate_idx on crashes (candidate_id) where candidate_id is not null;
create index crashes_date_idx on crashes (crash_date);

create table crash_quarantine (
  source_oid   bigint primary key,
  crash_id     text,
  reason       text not null check (reason in (
                 'no_coordinates', 'county_centroid', 'outside_georgia', 'xy_mismatch', 'default_location',
                 'missing_date', 'future_date', 'duplicate_report', 'private_property')),
  crash_date   date,
  county       text
);
create index crash_quarantine_reason_idx on crash_quarantine (reason);

-- ---------------------------------------------------------------------------
-- Analyses (reference runs computed by the Python implementation)
-- ---------------------------------------------------------------------------

create table analyses (
  id               bigserial primary key,
  school_id        char(12) not null references schools(id) on delete cascade,
  model_version    text not null references model_versions(version),
  radius_m         smallint not null check (radius_m in (400, 800, 1200)),
  period_years     smallint not null check (period_years in (1, 3)),
  crash_filter     text not null check (crash_filter in ('all', 'injury', 'pedestrian', 'lowLight')),
  scenario         text not null check (scenario in ('standard', 'pedestrian', 'injury', 'crash')),
  window_start     date not null,
  window_end       date not null check (window_end >= window_start),
  population       integer not null check (population >= 0),
  matched_crashes  integer not null check (matched_crashes >= 0),
  created_at       timestamptz not null default now(),
  unique (school_id, model_version, radius_m, period_years, crash_filter, scenario)
);

create table analysis_candidates (
  analysis_id         bigint not null references analyses(id) on delete cascade,
  candidate_id        text not null references candidate_locations(id) on delete cascade,
  rank                integer not null check (rank >= 1),
  priority            double precision not null check (priority >= 0 and priority <= 100),
  band                text not null check (band in ('high', 'elevated', 'moderate', 'lower')),
  score_crash         double precision check (score_crash between 0 and 100),
  score_injury        double precision check (score_injury between 0 and 100),
  score_pedestrian    double precision check (score_pedestrian between 0 and 100),
  score_traffic       double precision check (score_traffic between 0 and 100),   -- null = AADT unavailable
  score_proximity     double precision check (score_proximity between 0 and 100),
  crashes             integer not null check (crashes >= 0),
  injury_crashes      integer not null check (injury_crashes >= 0 and injury_crashes <= crashes),
  pedestrian_crashes  integer not null check (pedestrian_crashes >= 0 and pedestrian_crashes <= crashes),
  best_rank           integer not null check (best_rank >= 1),
  worst_rank          integer not null check (worst_rank >= best_rank),
  stability           text not null check (stability in ('high', 'moderate', 'low')),
  primary key (analysis_id, candidate_id),
  unique (analysis_id, rank)
);

create table validation_runs (
  id             bigserial primary key,
  experiment     text not null,
  model_version  text not null references model_versions(version),
  run_at         timestamptz not null default now(),
  title          text not null,
  reference      text not null,
  description    text not null,
  metrics        jsonb not null
);

-- ---------------------------------------------------------------------------
-- Read access for the public web app (anonymous role, read-only)
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array['data_sources','model_versions','pipeline_runs','schools','road_segments',
                           'traffic_counts','candidate_locations','school_candidates','crashes',
                           'crash_quarantine','analyses','analysis_candidates','validation_runs']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (true)', t || '_public_read', t);
  end loop;
end $$;
