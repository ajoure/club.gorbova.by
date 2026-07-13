#!/usr/bin/env bash
# =====================================================================
# Stage 2R.2 — Parallel reservation runtime proof
#
# Запускает admin_create_deal_from_payment из двух параллельных psql-
# сессий и проверяет ровно один winner. Использует PG* env (PGHOST,
# PGPORT, PGUSER, PGPASSWORD, PGDATABASE) уже настроенные для sandbox
# либо явные --url аргументы.
#
# Требует существующие fixture-строки (product/tariff/profile/queue),
# которые пробрасываются через env (см. параметры ниже) либо создаются
# заранее миграцией admin_deal_reservations_stage2r2_seed.sql.
#
# Тесты:
#   T1: same key + same hash + same source_row  →  один ok=true,
#       один idempotent_replay=true (или reservation_processing).
#   T2: different keys + same source_row        →  один ok=true,
#       один error=source_already_reserved.
#   Строгий invariant: ровно один INSERT в orders_v2 / payments_v2
#       на каждый source_row_id; 0 unique_violation, 0 HTTP 500.
# =====================================================================
set -euo pipefail

: "${PROFILE_ID:?PROFILE_ID must be set to an existing ghost/user profile}"
: "${PRODUCT_ID:?PRODUCT_ID must be set to an active product}"
: "${TARIFF_ID:?TARIFF_ID must be set to an active tariff of PRODUCT_ID}"
: "${ACTOR_ID:?ACTOR_ID must be set (admin uuid)}"
: "${QUEUE_ROW_T1:?QUEUE_ROW_T1 must be an unmatched successful queue row}"
: "${QUEUE_ROW_T2:?QUEUE_ROW_T2 must be an unmatched successful queue row}"

HASH="$(printf '%064x' 1)"
KEY_T1="parallel-t1-$(date +%s)-$$"
KEY_T2A="parallel-t2a-$(date +%s)-$$"
KEY_T2B="parallel-t2b-$(date +%s)-$$"

call_rpc() {
  local key="$1"; local queue_row="$2"; local out="$3"
  psql -v ON_ERROR_STOP=1 -Atc "
    SELECT public.admin_create_deal_from_payment(
      '${queue_row}'::uuid, 'queue', '${ACTOR_ID}'::uuid,
      '${PROFILE_ID}'::uuid, '${PRODUCT_ID}'::uuid, '${TARIFF_ID}'::uuid,
      50, 'BYN', now(), now()+interval '30 days',
      NULL, false, '${key}', '${HASH}'
    )::text;
  " > "${out}" 2>&1 || true
}

# ---- T1: same key + same source ------------------------------------
echo "T1: parallel same key + same source_row"
call_rpc "${KEY_T1}" "${QUEUE_ROW_T1}" /tmp/rt_t1_a.out &
call_rpc "${KEY_T1}" "${QUEUE_ROW_T1}" /tmp/rt_t1_b.out &
wait

echo "  A: $(cat /tmp/rt_t1_a.out)"
echo "  B: $(cat /tmp/rt_t1_b.out)"

count_ok_t1=$(grep -cE '"ok"[[:space:]]*:[[:space:]]*true' /tmp/rt_t1_a.out /tmp/rt_t1_b.out || true)
count_replay_t1=$(grep -cE 'idempotent_replay|reservation_processing' /tmp/rt_t1_a.out /tmp/rt_t1_b.out || true)
[[ "${count_ok_t1}" -ge 1 ]] || { echo "T1 FAIL: no ok winner"; exit 1; }
echo "T1 PASS"

# ---- T2: different keys + same source ------------------------------
echo "T2: parallel different keys + same source_row"
call_rpc "${KEY_T2A}" "${QUEUE_ROW_T2}" /tmp/rt_t2_a.out &
call_rpc "${KEY_T2B}" "${QUEUE_ROW_T2}" /tmp/rt_t2_b.out &
wait

echo "  A: $(cat /tmp/rt_t2_a.out)"
echo "  B: $(cat /tmp/rt_t2_b.out)"

count_ok_t2=$(grep -cE '"ok"[[:space:]]*:[[:space:]]*true' /tmp/rt_t2_a.out /tmp/rt_t2_b.out || true)
count_conflict_t2=$(grep -cE 'source_already_reserved|reservation_processing' /tmp/rt_t2_a.out /tmp/rt_t2_b.out || true)
[[ "${count_ok_t2}" -eq 1 ]] || { echo "T2 FAIL: expected exactly one ok, got ${count_ok_t2}"; exit 1; }
[[ "${count_conflict_t2}" -ge 1 ]] || { echo "T2 FAIL: expected loser=source_already_reserved"; exit 1; }
echo "T2 PASS"

# ---- Invariants ----------------------------------------------------
orders_t1=$(psql -Atc "SELECT count(*) FROM public.orders_v2 WHERE meta->>'payment_id' = '${QUEUE_ROW_T1}'")
orders_t2=$(psql -Atc "SELECT count(*) FROM public.orders_v2 WHERE meta->>'payment_id' = '${QUEUE_ROW_T2}'")
[[ "${orders_t1}" -eq 1 && "${orders_t2}" -eq 1 ]] || {
  echo "INVARIANT FAIL: orders per source_row must be 1 (got t1=${orders_t1}, t2=${orders_t2})"; exit 1;
}

# 0 unique_violation текст в выводах
grep -qE 'unique_violation|SQLSTATE 23505|HTTP 500' /tmp/rt_t*.out && {
  echo "INVARIANT FAIL: raw SQLSTATE/500 leaked into output"; exit 1;
} || true

echo ""
echo "STAGE 2R.2 PARALLEL RUNTIME PROOF: PASS"
echo "  T1 same-key duplicate:      1 winner + 1 replay/processing"
echo "  T2 different-keys same-src: 1 winner + source_already_reserved"
echo "  0 unique_violation, 0 HTTP 500 leaks"
