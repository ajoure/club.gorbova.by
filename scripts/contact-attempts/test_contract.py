import os
import pathlib
import subprocess

root = pathlib.Path(__file__).resolve().parents[2]
assert os.environ.get('CONTACT_ATTEMPTS_FIXTURE') == '1'
assert os.environ.get('PGHOST') == '127.0.0.1'
assert os.environ.get('PGDATABASE') == 'contact_attempts_test'

def sql(value, fail=False):
    r = subprocess.run(['psql', '-XAt', '-v', 'ON_ERROR_STOP=1', '-c', value], text=True, capture_output=True)
    assert (r.returncode != 0) if fail else (r.returncode == 0), r.stderr
    return r.stdout.strip()

assert sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'") == '0'
sql((root / 'scripts/contact-attempts/fixture.sql').read_text())
sql((root / 'supabase/migrations/20261106100000_contact_failed_attempt_history.sql').read_text())
subject = "SET fixture.subject='00000000-0000-0000-0000-000000000002'; SET fixture.allowed='yes';"
read = "SELECT count(*) FROM admin_get_contact_failed_attempts('00000000-0000-0000-0000-000000000001');"
def count(expected):
    assert sql(subject + read).splitlines()[-1] == str(expected)
count(2)
sql(subject + 'SET ROLE anon;' + read, fail=True)
sql("SET fixture.subject=''; SET fixture.allowed='yes';" + read, fail=True)
sql(subject + "SET fixture.allowed='no'; SET ROLE authenticated;" + read, fail=True)
assert sql(subject + "SELECT count(*) FROM admin_get_contact_failed_attempts('00000000-0000-0000-0000-000000000099');").splitlines()[-1] == '0'
for modify, restore in [
    ("UPDATE provider_subscriptions SET user_id=NULL", "UPDATE provider_subscriptions SET user_id='00000000-0000-0000-0000-000000000002'"),
    ("UPDATE payment_reconcile_queue SET has_conflict=true", "UPDATE payment_reconcile_queue SET has_conflict=false"),
    ("UPDATE payment_reconcile_queue SET transaction_type='Возврат средств'", "UPDATE payment_reconcile_queue SET transaction_type='Оплата'"),
    ("UPDATE payment_reconcile_queue SET raw_payload=jsonb_set(raw_payload,'{transaction,status}','\"successful\"')", "UPDATE payment_reconcile_queue SET raw_payload=jsonb_set(raw_payload,'{transaction,status}','\"failed\"')"),
    ("UPDATE payment_reconcile_queue SET matched_profile_id='00000000-0000-0000-0000-000000000099'", "UPDATE payment_reconcile_queue SET matched_profile_id=NULL"),
]:
    sql(modify); count(0); sql(restore); count(2)
sql("INSERT INTO payments_v2 VALUES('00000000-0000-0000-0000-000000000020','bepaid','uid10')")
count(1)
sql("INSERT INTO provider_subscriptions SELECT '00000000-0000-0000-0000-000000000030',subscription_v2_id,profile_id,user_id,provider,provider_subscription_id FROM provider_subscriptions LIMIT 1")
count(0)
print('PASS: PostgreSQL auth, exact lineage, conflicting identity, source status, UID dedup and ambiguity contracts')
