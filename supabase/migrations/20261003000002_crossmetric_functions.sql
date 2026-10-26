-- Query helpers used by the web app's PostGIS repository and for ad-hoc analysis.

-- Candidates around a school within a radius, nearest first.
create or replace function candidates_near_school(p_school_id char(12), p_radius_m real default 1200)
returns table (candidate_id text, distance_m real)
language sql stable as $$
  select sc.candidate_id, sc.distance_m
  from school_candidates sc
  where sc.school_id = p_school_id and sc.distance_m <= p_radius_m
  order by sc.distance_m, sc.candidate_id;
$$;

-- Independent spatial check of the precomputed school -> candidate distances.
-- Returns rows where PostGIS geography distance disagrees with the pipeline by
-- more than 2 m (should return nothing).
create or replace function audit_school_candidate_distances(p_school_id char(12))
returns table (candidate_id text, pipeline_m real, postgis_m double precision)
language sql stable as $$
  select sc.candidate_id, sc.distance_m, st_distance(s.geom, c.geom)
  from school_candidates sc
  join schools s on s.id = sc.school_id
  join candidate_locations c on c.id = sc.candidate_id
  where sc.school_id = p_school_id
    and abs(st_distance(s.geom, c.geom) - sc.distance_m) > 2;
$$;

-- Crashes recorded within a radius of a school, grouped by association status.
create or replace function crash_association_near_school(p_school_id char(12), p_radius_m real default 1200)
returns table (association text, crashes bigint)
language sql stable as $$
  select k.association, count(*)
  from crashes k
  join schools s on s.id = p_school_id
  where st_dwithin(k.geom, s.geom, p_radius_m)
  group by k.association
  order by count(*) desc;
$$;
