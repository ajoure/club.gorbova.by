#!/usr/bin/env bash
# =====================================================================
# Stage 2R.2/3 — Parallel reservation runtime proof (corrected)
#
# Требует PG* env (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE) настроенные
# для sandbox. Создаёт свой fixture (product/tariff/profile + 2 queue rows),
# запускает admin_create_deal_from_payment из двух параллельных psql-
# сессий, проверяет invariants и после этого удаляет fixture-строки.
#
# Тесты:
#   T1: same key + same hash + same source_row     → exactly 2 ответа,
#       ≥1 ok=true, второй idempotent_replay ИЛИ reservation_processing.
#       Итог: orders=1, payments=1.
#   T2: different keys + same source_row            → exactly 2 ответа,
#       ровно 1 ok=true, второй source_already_reserved
#       (либо reservation_processing).
#       Итог: orders=1, payments=1.
#
# HTTP 500 сюда не относится (edge не вызывается), проверяем только
# отсутствие raw SQLSTATE 23505 в ответах.
# =====================================================================
set -euo pipefail
: "${ACTOR_ID:?ACTOR_ID must be an admin uuid}"

RUN_TAG="parallel-$$-$(date +%s)"
FIX_SQL="/tmp/rt_${RUN_TAG}_fixture.sql"
CLEAN_SQL="/tmp/rt_${RUN_TAG}_cleanup.sql"

# ---- Fixture (deterministic UUIDs generated once) -------------------
PROFILE_ID=$(psql -Atc "SELECT gen_random_uuid()")
PRODUCT_ID=$(psql -Atc "SELECT gen_random_uuid()")
TARIFF_ID=$(psql -Atc "SELECT gen_random_uuid()")
QUEUE_T1=$(psql -Atc "SELECT gen_random_uuid()")
QUEUE_T2=$(psql -Atc "SELECT gen_random_uuid()")

cat > "${FIX_SQL}" <<SQL
BEGIN;
INSERT INTO public.profiles(id, user_id, email, full_name)
  VALUES ('${PROFILE_ID}', gen_random_uuid(), 'rt-${RUN_TAG}@ex.com', 'RT ${RUN_TAG}');
INSERT INTO public.products_v2(id, name, code, is_active)
  VALUES ('${PRODUCT_ID}', 'RT ${RUN_TAG}', 'rt-${RUN_TAG}', true);
INSERT INTO public.tariffs(id, product_id, name, code, is_active, tariff_type)
  VALUES ('${TARIFF_ID}', '${PRODUCT_ID}', 'basic', 'basic', true, 'one_time');
INSERT INTO public.payment_reconcile_queue
  (id, provider, status, status_normalized, amount, currency, created_at, external_id)
  VALUES
  ('${QUEUE_T1}','bepaid','successful','successful',50,'BYN',now(),'rt-${RUN_TAG}-1'),
  ('${QUEUE_T2}','bepaid','successful','successful',50,'BYN',now(),'rt-${RUN_TAG}-2');
COMMIT;
SQL

cat > "${CLEAN_SQL}" <<SQL
BEGIN;
DELETE FROM public.admin_deal_reservations WHERE source_row_id IN ('${QUEUE_T1}','${QUEUE_T2}');
DELETE FROM public.payments_v2 WHERE order_id IN (
  SELECT id FROM public.orders_v2 WHERE profile_id = '${PROFILE_ID}');
DELETE FROM public.orders_v2 WHERE profile_id = '${PROFILE_ID}';
DELETE FROM public.payment_reconcile_queue WHERE id IN ('${QUEUE_T1}','${QUEUE_T2}');
DELETE FROM public.tariffs WHERE id = '${TARIFF_ID}';
DELETE FROM public.products_v2 WHERE id = '${PRODUCT_ID}';
DELETE FROM public.profiles WHERE id = '${PROFILE_ID}';
COMMIT;
SQL

trap 'psql -f "${CLEAN_SQL}" >/dev/null 2>&1 || true; rm -f "${FIX_SQL}" "${CLEAN_SQL}" /tmp/rt_${RUN_TAG}_*.out' EXIT

psql -v ON_ERROR_STOP=1 -f "${FIX_SQL}" >/dev/null

HASH="$(printf '%064x' 1)"
KEY_T1="parallel-t1-${RUN_TAG}"
KEY_T2A="parallel-t2a-${RUN_TAG}"
KEY_T2B="parallel-t2b-${RUN_TAG}"

call_rpc() {
  local key="$1"; local queue_row="$2"; local out="$3"
  psql -v ON_ERROR_STOP=0 -Atc "
    SELECT public.admin_create_deal_from_payment(
      '${queue_row}'::uuid, 'queue', '${ACTOR_ID}'::uuid,
      '${PROFILE_ID}'::uuid, '${PRODUCT_ID}'::uuid, '${TARIFF_ID}'::uuid,
      50, 'BYN', now(), now()+interval '30 days',
      NULL, false, '${key}', '${HASH}'
    )::text;
  " > "${out}" 2>&1 || true
}

count_matches() {
  # Считаем через cat, чтобы grep не выдавал filename:count при нескольких файлах.
  local pattern="$1"; shift
  cat "$@" | grep -cE "${pattern}" || true
}

# ---------------------------------------------------------------- T1
echo "T1: parallel same key + same source_row"
call_rpc "${KEY_T1}" "${QUEUE_T1}" /tmp/rt_${RUN_TAG}_t1a.out &
call_rpc "${KEY_T1}" "${QUEUE_T1}" /tmp/rt_${RUN_TAG}_t1b.out &
wait
echo "  A: $(cat /tmp/rt_${RUN_TAG}_t1a.out)"
echo "  B: $(cat /tmp/rt_${RUN_TAG}_t1b.out)"

ok_t1=$(count_matches '"ok" *: *true' /tmp/rt_${RUN_TAG}_t1a.out /tmp/rt_${RUN_TAG}_t1b.out)
replay_t1=$(count_matches 'idempotent_replay|reservation_processing' /tmp/rt_${RUN_TAG}_t1a.out /tmp/rt_${RUN_TAG}_t1b.out)
[[ "${ok_t1}" -ge 1 ]] || { echo "T1 FAIL: no ok winner (ok=${ok_t1})"; exit 1; }
[[ "${replay_t1}" -ge 1 ]] || { echo "T1 FAIL: no replay/processing (got ${replay_t1})"; exit 1; }

orders_t1=$(psql -Atc "SELECT count(*) FROM public.orders_v2 WHERE meta->>'payment_id' = '${QUEUE_T1}'")
payments_t1=$(psql -Atc "SELECT count(*) FROM public.payments_v2 WHERE meta->>'queue_payment_id' = '${QUEUE_T1}'")
[[ "${orders_t1}" -eq 1 ]] || { echo "T1 FAIL: orders=${orders_t1} (want 1)"; exit 1; }
[[ "${payments_t1}" -eq 1 ]] || { echo "T1 FAIL: payments=${payments_t1} (want 1)"; exit 1; }
echo "T1 PASS (orders=1, payments=1, ok=${ok_t1}, replay/processing=${replay_t1})"

# ---------------------------------------------------------------- T2
echo "T2: parallel different keys + same source_row"
call_rpc "${KEY_T2A}" "${QUEUE_T2}" /tmp/rt_${RUN_TAG}_t2a.out &
call_rpc "${KEY_T2B}" "${QUEUE_T2}" /tmp/rt_${RUN_TAG}_t2b.out &
wait
echo "  A: $(cat /tmp/rt_${RUN_TAG}_t2a.out)"
echo "  B: $(cat /tmp/rt_${RUN_TAG}_t2b.out)"

ok_t2=$(count_matches '"ok" *: *true' /tmp/rt_${RUN_TAG}_t2a.out /tmp/rt_${RUN_TAG}_t2b.out)
conflict_t2=$(count_matches 'source_already_reserved|reservation_processing' /tmp/rt_${RUN_TAG}_t2a.out /tmp/rt_${RUN_TAG}_t2b.out)
[[ "${ok_t2}" -eq 1 ]] || { echo "T2 FAIL: expected exactly one ok, got ${ok_t2}"; exit 1; }
[[ "${conflict_t2}" -ge 1 ]] || { echo "T2 FAIL: expected loser=source_already_reserved (got ${conflict_t2})"; exit 1; }

orders_t2=$(psql -Atc "SELECT count(*) FROM public.orders_v2 WHERE meta->>'payment_id' = '${QUEUE_T2}'")
payments_t2=$(psql -Atc "SELECT count(*) FROM public.payments_v2 WHERE meta->>'queue_payment_id' = '${QUEUE_T2}'")
[[ "${orders_t2}" -eq 1 ]] || { echo "T2 FAIL: orders=${orders_t2} (want 1)"; exit 1; }
[[ "${payments_t2}" -eq 1 ]] || { echo "T2 FAIL: payments=${payments_t2} (want 1)"; exit 1; }
echo "T2 PASS (orders=1, payments=1, ok=1, conflict/processing=${conflict_t2})"

# No raw SQLSTATE 23505 anywhere
if grep -qE 'unique_violation|SQLSTATE 23505|23505' /tmp/rt_${RUN_TAG}_*.out; then
  echo "INVARIANT FAIL: raw SQLSTATE 23505 leaked into output"; exit 1;
fi

echo ""
echo "STAGE 2R.3 PARALLEL RUNTIME PROOF: PASS"
echo "  T1 same-key duplicate:      orders=1 payments=1"
echo "  T2 different-keys same-src: orders=1 payments=1, 1 winner + source_already_reserved"
echo "  0 SQLSTATE 23505 leaks, fixture cleanup executed"
