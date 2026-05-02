ALTER TABLE public._inv22_overshoot_snapshot 
  DROP CONSTRAINT IF EXISTS _inv22_overshoot_snapshot_cohort_check;
ALTER TABLE public._inv22_overshoot_snapshot 
  ADD CONSTRAINT _inv22_overshoot_snapshot_cohort_check 
  CHECK (cohort IN ('club','business','silent','skip'));