#!/usr/bin/env bash
set -euo pipefail
# Only an explicitly disposable local PostgreSQL service, never a hosted URL.
if [[ "${BILLING_UNLINK_LOCAL_TEST:-}" != 1 || "${PGHOST:-}" != 127.0.0.1 || "${PGDATABASE:-}" != unlink_fixture ]]; then
  echo 'Requires BILLING_UNLINK_LOCAL_TEST=1 PGHOST=127.0.0.1 PGDATABASE=unlink_fixture' >&2
  exit 1
fi
cd "$(dirname "$0")/../.."
scratch="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/billing-unlink-race.XXXXXX")"
trap 'rm -f "$scratch/first.log" "$scratch/second.log"; rmdir "$scratch"' EXIT
query() { psql -X -qAt -v ON_ERROR_STOP=1 -c "$1"; }
admin="SELECT set_config('request.jwt.claim.role','authenticated',false),set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000101',false);"
service="SELECT set_config('request.jwt.claim.role','service_role',false),set_config('request.jwt.claim.sub','',false);"
unlink="SELECT public.crm_company_unlink_billing_contact('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000041','Fixture race');"
backfill="SELECT public.crm_company_backfill_billing_cld('00000000-0000-4000-8000-000000000021');"
node scripts/company-billing-unlink/fixture.mjs --emit-fixture | psql -X -q -v ON_ERROR_STOP=1 >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -f supabase/migrations/20261103125859_crm_company_billing_contact_unlink.sql >/dev/null

wait_for_first_lock() {
  for _ in {1..100}; do
    if [[ "$(query "SELECT count(*) FROM pg_stat_activity WHERE application_name='unlink_fixture_first' AND wait_event='PgSleep'")" == 1 ]]; then return; fi
    sleep 0.05
  done
  echo 'First transaction did not reach its held-lock checkpoint' >&2
  return 1
}
race() {
  local first="$1" second="$2" label="$3" first_pid second_pid
  PGAPPNAME=unlink_fixture_first query "BEGIN; SET LOCAL statement_timeout='10s'; $first SELECT pg_sleep(2); COMMIT;" >"$scratch/first.log" 2>&1 &
  first_pid=$!
  wait_for_first_lock
  PGAPPNAME=unlink_fixture_second query "BEGIN; SET LOCAL statement_timeout='10s'; $second COMMIT;" >"$scratch/second.log" 2>&1 &
  second_pid=$!
  if ! wait "$first_pid"; then cat "$scratch/first.log"; return 1; fi
  if ! wait "$second_pid"; then cat "$scratch/second.log"; return 1; fi
  [[ "$(query "SELECT count(*) FROM public.company_contacts WHERE company_id='00000000-0000-4000-8000-000000000001' AND profile_id='00000000-0000-4000-8000-000000000011'")" == 0 ]]
  [[ "$(query 'SELECT count(*) FROM public.crm_company_billing_link_suppressions WHERE revoked_at IS NULL')" == 1 ]]
  echo "PASS: $label; both committed, no resurrected contact"
}

race "$service $backfill" "$admin $unlink" writer-first
query "$admin SELECT public.crm_company_restore_billing_contact(id) FROM public.crm_company_billing_link_suppressions WHERE revoked_at IS NULL;" >/dev/null
race "$admin $unlink" "$service $backfill" unlink-first
# Exercise the direct canonical linker, whose lock order differs from backfill.
query "$admin SELECT public.crm_company_restore_billing_contact(id) FROM public.crm_company_billing_link_suppressions WHERE revoked_at IS NULL;" >/dev/null
link="SELECT public.crm_company_link_contact('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000011','billing_contact',true,'billing_requisites','00000000-0000-4000-8000-000000000031');"
race "$admin $link" "$admin $unlink" linker-first
query "$admin SELECT public.crm_company_restore_billing_contact(id) FROM public.crm_company_billing_link_suppressions WHERE revoked_at IS NULL;" >/dev/null
race "$admin $unlink" "$admin $link" unlink-before-linker
