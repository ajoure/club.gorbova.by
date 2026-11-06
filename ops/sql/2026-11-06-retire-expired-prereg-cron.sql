-- Project-specific operational change, not an application/schema migration.
-- Execution is separate from source approval: official Lovable only, exact
-- merged bytes/SHA256, fresh project/actor/lease, then independent read-back.
-- Only two granted owner-API calls may mutate state; never invoke the worker.
-- Contract: target end state as of read-back, NOT strict active-state CAS.
DO $retire_expired_prereg_cron$
DECLARE
  v_api_oid oid;
  v_api_matches boolean;
  v_role_matches boolean;
  v_trigger_matches boolean;
  v_job_count bigint;
  v_active_count bigint;
  v_inactive_count bigint;
  v_metadata jsonb;
  v_pending_count bigint;
  v_token_count bigint;
  v_other_target_count bigint;
  v_other_count bigint;
  v_other_digest text;
  v_initial_other_count bigint;
  v_initial_other_digest text;
  v_api_processed_jobs integer := 0;
  v_phase integer;
  v_expected_metadata constant jsonb := '[
    {"jobid":23,"jobname":"preregistration-charge-morning","schedule":"0 6 1-4 * *","command_md5":"73c99299e0b326ecee2d10960a68e266","database_md5":"e8a48653851e28c69d0506508fb27fc5","username_md5":"e8a48653851e28c69d0506508fb27fc5","non_active_md5":"3f198c3073000de13f34951c02b3060b","target_matches":true,"owner_matches":true},
    {"jobid":24,"jobname":"preregistration-charge-evening","schedule":"0 18 1-4 * *","command_md5":"ff0f38de8f61cc56a7ba01e2859f177a","database_md5":"e8a48653851e28c69d0506508fb27fc5","username_md5":"e8a48653851e28c69d0506508fb27fc5","non_active_md5":"8b1d39111d9863f2050d1d5fea5cd549","target_matches":true,"owner_matches":true}
  ]'::jsonb;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);

  -- Pin the observed executor, without SET ROLE, new grants, or table UPDATE.
  SELECT NOT r.rolsuper AND r.rolbypassrls
    INTO v_role_matches
    FROM pg_catalog.pg_roles AS r
   WHERE r.rolname = current_user;
  IF v_role_matches IS DISTINCT FROM true
     OR pg_catalog.md5(current_user::text) <> 'e8a48653851e28c69d0506508fb27fc5'
     OR pg_catalog.md5(pg_catalog.current_database()) <> 'e8a48653851e28c69d0506508fb27fc5'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off'
     OR pg_catalog.current_setting('transaction_isolation') <> 'read committed'
     OR pg_catalog.to_regclass('cron.job') IS NULL
     OR pg_catalog.to_regclass('public.course_preregistrations') IS NULL
  THEN
    RAISE EXCEPTION 'Retirement STOP: executor, transaction, or relation drift';
  END IF;

  -- Visibility is an observed actor property, not inferred from !superuser.
  IF pg_catalog.row_security_active('cron.job'::regclass)
     OR pg_catalog.row_security_active('public.course_preregistrations'::regclass)
     OR NOT pg_catalog.has_table_privilege(current_user, 'cron.job', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(current_user, 'public.course_preregistrations', 'SELECT')
  THEN
    RAISE EXCEPTION 'Retirement STOP: audited snapshot visibility changed';
  END IF;

  v_api_oid := pg_catalog.to_regprocedure('cron.alter_job(bigint,text,text,text,text,boolean)');
  SELECT p.oid = 29469
         AND l.lanname = 'c'
         AND p.prosrc = 'cron_alter_job'
         AND p.probin = '$libdir/pg_cron'
         AND NOT p.prosecdef AND NOT p.proisstrict AND NOT p.proretset
         AND p.provolatile = 'v' AND p.prorettype = 'void'::regtype
         AND p.pronargs = 6 AND p.pronargdefaults = 5
         AND p.proargnames = ARRAY['job_id','schedule','command','database','username','active']::text[]
         AND pg_catalog.pg_get_expr(p.proargdefaults, 0) =
             'NULL::text, NULL::text, NULL::text, NULL::text, NULL::boolean'
         AND e.extversion = '1.6.4'
         AND pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE')
    INTO v_api_matches
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
    JOIN pg_catalog.pg_depend AS d
      ON d.classid = 'pg_proc'::regclass AND d.objid = p.oid
     AND d.refclassid = 'pg_extension'::regclass AND d.deptype = 'e'
    JOIN pg_catalog.pg_extension AS e
      ON e.oid = d.refobjid AND e.extname = 'pg_cron'
   WHERE p.oid = v_api_oid;
  IF v_api_matches IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Retirement STOP: granted native owner API drift';
  END IF;

  -- A unique jobid bounds each native UPDATE to one row. Only the standard
  -- statement-level cache invalidation trigger/rules contract is accepted.
  -- Count ALL triggers: internal/FK triggers must not hide extra side effects.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = c.conrelid AND a.attname = 'jobid' AND NOT a.attisdropped
    WHERE c.conrelid = 'cron.job'::regclass AND c.contype = 'p'
      AND c.conkey = ARRAY[a.attnum]::smallint[]
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_rewrite AS r WHERE r.ev_class = 'cron.job'::regclass
  ) THEN
    RAISE EXCEPTION 'Retirement STOP: cron job key or rule drift';
  END IF;
  SELECT pg_catalog.count(*) = 1 AND coalesce(pg_catalog.bool_and(
           NOT t.tgisinternal
           AND t.tgname = 'cron_job_cache_invalidate' AND t.tgtype = 60
           AND t.tgenabled = 'O' AND p.prosrc = 'cron_job_cache_invalidate'
           AND p.probin = '$libdir/pg_cron' AND l.lanname = 'c'
           AND n.nspname = 'cron' AND p.proname = 'job_cache_invalidate'
           AND p.pronargs = 0 AND p.prorettype = 'trigger'::regtype
           AND NOT p.prosecdef
         ), false)
    INTO v_trigger_matches
    FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_proc AS p ON p.oid = t.tgfoid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
   WHERE t.tgrelid = 'cron.job'::regclass;
  IF v_trigger_matches IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Retirement STOP: cron invalidation trigger drift';
  END IF;

  -- Repeat the same metadata/aggregate observations before and after the API.
  -- No raw command, token, client ID, or provider response leaves this block.
  FOR v_phase IN 1..2 LOOP
    IF pg_catalog.clock_timestamp() <= timestamptz '2026-02-04T20:59:59Z'
       OR extract(day FROM pg_catalog.clock_timestamp() AT TIME ZONE 'UTC') <= 4
    THEN
      RAISE EXCEPTION 'Retirement STOP: historical deadline or monthly execution window';
    END IF;

    SELECT pg_catalog.count(*), pg_catalog.count(*) FILTER (WHERE j.active IS TRUE),
           pg_catalog.count(*) FILTER (WHERE j.active IS FALSE),
           pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'jobid', j.jobid, 'jobname', j.jobname, 'schedule', j.schedule,
             'command_md5', pg_catalog.md5(j.command), 'database_md5', pg_catalog.md5(j.database),
             'username_md5', pg_catalog.md5(j.username),
             'non_active_md5', pg_catalog.md5((pg_catalog.to_jsonb(j) - 'active')::text),
             'target_matches', j.command LIKE '%/functions/v1/preregistration-charge-cron%',
             'owner_matches', j.username = current_user
           ) ORDER BY j.jobid)
      INTO v_job_count, v_active_count, v_inactive_count, v_metadata
      FROM cron.job AS j WHERE j.jobid IN (23, 24);
    IF v_job_count <> 2 OR v_metadata IS DISTINCT FROM v_expected_metadata THEN
      RAISE EXCEPTION 'Retirement STOP: target identity, owner, or non-active metadata drift';
    END IF;

    SELECT pg_catalog.count(*) FILTER (WHERE p.status = 'pending_charge'),
           pg_catalog.count(*) FILTER (WHERE p.meta->'payment_token' IS NOT NULL)
      INTO v_pending_count, v_token_count
      FROM public.course_preregistrations AS p;
    IF v_pending_count <> 0 OR v_token_count <> 0 THEN
      RAISE EXCEPTION 'Retirement STOP: current preregistration queue or stored token';
    END IF;

    SELECT pg_catalog.count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.md5(pg_catalog.to_jsonb(j)::text), '' ORDER BY j.jobid), '')),
           pg_catalog.count(*) FILTER (WHERE j.command LIKE '%preregistration-charge-cron%')
      INTO v_other_count, v_other_digest, v_other_target_count
      FROM cron.job AS j WHERE j.jobid NOT IN (23, 24);
    IF v_other_target_count <> 0 THEN
      RAISE EXCEPTION 'Retirement STOP: another job references the target';
    END IF;

    IF v_phase = 1 THEN
      v_initial_other_count := v_other_count;
      v_initial_other_digest := v_other_digest;
      IF v_active_count = 2 THEN
        -- The public API internally mediates ownership and acquires native
        -- writer locks. No explicit table lock or no-op lock probe is used.
        -- Concurrent deactivation of the same target is benign, not a claim
        -- that exactly two effective transitions were caused by this script.
        PERFORM cron.alter_job(job_id := 23::bigint, active := false);
        v_api_processed_jobs := v_api_processed_jobs + 1;
        PERFORM cron.alter_job(job_id := 24::bigint, active := false);
        v_api_processed_jobs := v_api_processed_jobs + 1;
      ELSIF v_inactive_count <> 2 THEN
        RAISE EXCEPTION 'Retirement STOP: initial mixed active state';
      END IF;
    ELSE
      IF v_active_count <> 0 OR v_inactive_count <> 2
         OR v_other_count IS DISTINCT FROM v_initial_other_count
         OR v_other_digest IS DISTINCT FROM v_initial_other_digest
      THEN
        RAISE EXCEPTION 'Retirement STOP: target poststate or other-job snapshot conflict';
      END IF;
      RAISE NOTICE '%', pg_catalog.jsonb_build_object(
        'operation', 'retire_expired_prereg_cron',
        'status', CASE WHEN v_api_processed_jobs = 0
                       THEN 'NOOP_PENDING_INDEPENDENT_READBACK'
                       ELSE 'APPLIED_PENDING_INDEPENDENT_READBACK' END,
        'api_processed_jobs', v_api_processed_jobs, 'target_inactive', 2,
        'pending_charge_rows', v_pending_count, 'stored_token_rows', v_token_count,
        'other_jobs_count', v_other_count, 'other_jobs_digest', v_other_digest,
        'snapshot_visibility', 'audited actor bypasses RLS; cron row security inactive',
        'snapshot_only', true, 'requires_independent_readback', true
      );
    END IF;
  END LOOP;
END;
$retire_expired_prereg_cron$;
