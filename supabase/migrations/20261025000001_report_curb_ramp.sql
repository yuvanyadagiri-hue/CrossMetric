-- CrossMetric redesign (2026-10-25): curb ramps are their own report category.
-- The inline check from 20261005000001 is named community_reports_category_check by Postgres.
alter table community_reports drop constraint if exists community_reports_category_check;
alter table community_reports add constraint community_reports_category_check check (category in (
  'missing_sidewalk', 'damaged_sidewalk', 'difficult_crossing', 'blocked_path', 'curb_ramp',
  'poor_visibility', 'construction', 'bike_lane', 'bus_stop', 'other'));
