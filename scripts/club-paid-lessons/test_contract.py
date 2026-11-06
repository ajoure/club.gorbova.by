#!/usr/bin/env python3
"""Real PostgreSQL authorization/paid-right contracts. Explicit synthetic DB only."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / 'supabase/migrations/20261106071934_club_paid_lesson_corrections.sql'
SCRIPT = MIGRATION.read_text()


def require(condition, label):
    if not condition:
        raise AssertionError(label)


def sql(query, ok=True):
    p = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1'],
                       input=query, text=True, capture_output=True)
    if ok and p.returncode:
        raise AssertionError(p.stderr[-2500:])
    return p


def value(query):
    return sql(query).stdout.strip()


def uid(n):
    return f'00000000-0000-0000-0000-{n:012d}'


checks = 0


def check(query, expected, label):
    global checks
    actual = value(query)
    require(actual == str(expected), f'{label}: {actual!r} != {expected!r}')
    checks += 1


def denied(query, label):
    global checks
    p = sql(query, ok=False)
    require(p.returncode != 0, label)
    checks += 1


def static():
    require(SCRIPT.startswith('--') and '\nBEGIN;' in SCRIPT and SCRIPT.rstrip().endswith('COMMIT;'), 'atomic migration')
    require('CREATE OR REPLACE FUNCTION public.has_month_purchase(' not in SCRIPT, 'generic single unchanged')
    require('INSERT INTO public.orders_v2' not in SCRIPT and 'UPDATE public.subscriptions_v2' not in SCRIPT, 'no fake money or extension')
    require('split_part(target_key' in SCRIPT and 'allow_module' in SCRIPT, 'real UI tuple and navigation contracts')
    require('actual source' not in SCRIPT.lower(), 'no runtime success assertion in source')
    print(json.dumps({'static': 'PASS', 'migration_sha256': hashlib.sha256(SCRIPT.encode()).hexdigest()}))


def main():
    static()
    if '--static' in sys.argv:
        return
    require(os.environ.get('CLUB_PAID_LESSON_FIXTURE') == '1', 'explicit fixture opt-in required')
    require(os.environ.get('PGHOST') in ('127.0.0.1', 'localhost'), 'loopback only')
    require(os.environ.get('PGDATABASE') == 'club_paid_lesson_test', 'synthetic DB name required')
    require(value('SELECT count(*) FROM pg_tables WHERE schemaname NOT IN(\'pg_catalog\',\'information_schema\');') == '0', 'empty disposable DB required')
    # Create tables first, then load the exact three Git-owned baseline bodies.
    fixture = (ROOT / 'scripts/club-paid-lessons/fixture.sql').read_text()
    late_guard = fixture.index('CREATE FUNCTION public.historical_lesson_access_guard')
    sql(fixture[:late_guard])
    sql((ROOT / 'supabase/migrations/20260817092551_1d8d9274-70e0-4c81-b8f1-2e5f113a1c81.sql').read_text())
    sql((ROOT / 'supabase/migrations/20260602122043_f05562e0-ae19-49c0-8d5d-c16d0b0a56da.sql').read_text())
    prior = (ROOT / 'supabase/migrations/20261020131240_club_cb2_bonus_access.sql').read_text()
    definition = re.search(r'CREATE OR REPLACE FUNCTION public\.user_has_training_lesson_access\(.*?\$fn\$;', prior, re.S).group()
    sql(definition)
    sql(fixture[late_guard:])
    sql('''REVOKE ALL ON FUNCTION public.has_month_purchase(uuid,uuid,text),
      public.has_month_purchase_bulk(uuid,jsonb),public.user_has_training_lesson_access(uuid,uuid) FROM PUBLIC,anon;
      GRANT EXECUTE ON FUNCTION public.has_month_purchase(uuid,uuid,text),public.has_month_purchase_bulk(uuid,jsonb),
        public.user_has_training_lesson_access(uuid,uuid) TO authenticated,service_role,sandbox_exec_hdjgkjceownmmnrqqtuz;
      GRANT EXECUTE ON FUNCTION public.user_has_training_lesson_access(uuid,uuid) TO anon;''')
    check("SELECT md5(prosrc) FROM pg_proc WHERE oid='public.user_has_training_lesson_access(uuid,uuid)'::regprocedure;", 'f637058db4edb7f6daea8257727e8b60', 'real baseline body')
    before = value("SELECT jsonb_agg(jsonb_build_array(oid,proacl,proowner)) FROM pg_proc WHERE oid IN('public.has_month_purchase_bulk(uuid,jsonb)'::regprocedure,'public.user_has_training_lesson_access(uuid,uuid)'::regprocedure);")
    sql(SCRIPT)
    after = value("SELECT jsonb_agg(jsonb_build_array(oid,proacl,proowner)) FROM pg_proc WHERE oid IN('public.has_month_purchase_bulk(uuid,jsonb)'::regprocedure,'public.user_has_training_lesson_access(uuid,uuid)'::regprocedure);")
    require(before == after, 'OID/ACL/owner preserved')
    u, p, tariff, subscription, payment, lesson, other, parent, root, rule = [uid(i) for i in range(1, 11)]
    club = '11c9f1b8-0355-4753-bd74-40b42aa53616'
    month = value("SELECT to_char(now()-interval '1 month','YYYY-MM');")
    end = value("SELECT (date_trunc('second',now())+interval '2 months')::text;")
    sql(f"""INSERT INTO auth.users VALUES('{u}'),('{uid(80)}');
      INSERT INTO public.profiles VALUES('{p}','{u}'); INSERT INTO public.tariffs VALUES('{tariff}'),('{uid(81)}');
      INSERT INTO public.training_modules VALUES('{root}',NULL,'{club}',true),('{parent}','{root}',NULL,true);
      INSERT INTO public.training_lessons VALUES('{lesson}','{parent}','{month}',true,true),('{other}','{parent}','{month}',true,true);
      INSERT INTO public.subscriptions_v2 VALUES('{subscription}','{u}','{p}','{club}','{tariff}','active',now()-interval '3 months','{end}');
      INSERT INTO public.payments_v2(id,profile_id,status,currency,amount,refunded_amount,is_deleted) VALUES('{payment}','{p}','succeeded','BYN',800,50,false);
      INSERT INTO public.access_rules VALUES('{rule}','{club}','{tariff}','training_content','{root}',true,
       '{{"access_mode":"full","allowed_lesson_ids":[],"allowed_module_ids":[],"match_purchase_month":true}}');""")
    baseline = value("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(x)) FROM public.payments_v2 x),(SELECT jsonb_agg(to_jsonb(x)) FROM public.subscriptions_v2 x),(SELECT jsonb_agg(to_jsonb(x)) FROM public.orders_v2 x));")
    args = [f"'{uid(50)}'", f"'{u}'", f"'{p}'", f"'{subscription}'", f"'{payment}'", f"'{tariff}'", f"'{lesson}'", f"'{month}'", '750', f"'{end}'", "'synthetic-owner-agreement:1'", "'fixture-operator'"]

    def record(changes=None, role='service_role'):
        a = args.copy()
        for i, v in (changes or {}).items():
            a[i] = v
        return f"SET ROLE {role}; SELECT public.record_club_paid_lesson_correction({','.join(a)});"

    def gate(target=lesson, user=u, t=tariff, m=month):
        payload = json.dumps([{'lesson_id': target, 'tariff_id': t, 'content_month': m}])
        return f"SELECT has_purchase::text FROM public.has_month_purchase_bulk('{user}','{payload}'::jsonb);"

    check(gate(), 'false', 'original missing paid month reproduced')
    denied(record(role='anon'), 'anon writer denied')
    denied(record(role='authenticated'), 'authenticated writer denied')
    for changes in ({1: f"'{uid(80)}'"}, {5: f"'{uid(81)}'"}, {7: "'1999-01'"}, {8: '751'}, {9: "now()+interval '10 years'"}):
        denied(record(changes), 'invalid source rejected atomically')
    check('SELECT count(*) FROM private.club_paid_lesson_corrections;', 0, 'rejections leave no correction')
    check('SELECT count(*) FROM private.club_paid_lesson_correction_audit;', 0, 'rejections leave no audit')
    require(json.loads(value(record()))['created'] is True, 'one legitimate existing-paid correction')
    require(json.loads(value(record()))['created'] is False, 'idempotent replay')
    denied(record({11: "'different-operator'"}), 'conflicting replay denied')
    denied(record({0: f"'{uid(51)}'"}), 'duplicate active right under new key denied')
    check('SELECT count(*) FROM private.club_paid_lesson_correction_audit;', 1, 'exactly one audit')
    check(gate(), 'true', 'plain lesson ID')
    check(gate(f'{lesson}::{tariff}'), 'true', 'actual lesson::tariff UI key')
    check(gate(f'{parent}::{tariff}'), 'true', 'containing module navigation')
    check(gate(f'{root}::{tariff}'), 'true', 'ancestor navigation')
    for target in [other, f'{other}::{tariff}', 'live-access-month-0', 'invalid', f'{lesson}::{uid(81)}']:
        check(gate(target), 'false', 'unapproved/opaque key cannot acquire right')
    check(gate(user=uid(80)), 'false', 'other user')
    check(gate(t=uid(81)), 'false', 'other tariff')
    check(gate(m='1999-01'), 'false', 'other month')
    check(f"SELECT public.has_month_purchase('{u}','{tariff}','{month}')::text;", 'false', 'no fictitious entire-month purchase')
    check(f"SELECT public.user_has_training_lesson_access('{u}','{lesson}')::text;", 'true', 'server lesson reader')
    check(f"SELECT public.historical_lesson_access_guard('{u}','{lesson}')::text;", 'true', 'RLS reader sees same exact right')
    check(f"SELECT public.user_has_training_lesson_access('{u}','{other}')::text;", 'false', 'server sibling denied')
    check(f"SELECT public.user_has_training_lesson_access('{u}','{uid(99)}')::text;", 'true', 'previous legacy reader preserved')
    # Every live prerequisite is rechecked; a stored row is not a perpetual grant.
    mutations = [
        ("UPDATE private.club_paid_lesson_corrections SET revoked_at=now();", "UPDATE private.club_paid_lesson_corrections SET revoked_at=NULL;"),
        ("UPDATE private.club_paid_lesson_corrections SET valid_until=now()-interval '1 second';", f"UPDATE private.club_paid_lesson_corrections SET valid_until='{end}';"),
        ("UPDATE public.subscriptions_v2 SET access_end_at=now()-interval '1 second';", f"UPDATE public.subscriptions_v2 SET access_end_at='{end}';"),
        ("UPDATE public.subscriptions_v2 SET status='expired';", "UPDATE public.subscriptions_v2 SET status='active';"),
        ("UPDATE public.payments_v2 SET refunded_amount=800;", "UPDATE public.payments_v2 SET refunded_amount=50;"),
        ("UPDATE public.payments_v2 SET is_deleted=true;", "UPDATE public.payments_v2 SET is_deleted=false;"),
        ("UPDATE public.payments_v2 SET transaction_type='refund';", "UPDATE public.payments_v2 SET transaction_type='payment';"),
        ("UPDATE public.payments_v2 SET refunded_amount=-1;", "UPDATE public.payments_v2 SET refunded_amount=50;"),
        ("UPDATE public.access_rules SET is_active=false;", "UPDATE public.access_rules SET is_active=true;"),
        (f"UPDATE public.training_lessons SET released=false WHERE id='{lesson}';", f"UPDATE public.training_lessons SET released=true WHERE id='{lesson}';"),
        (f"UPDATE public.training_modules SET product_id='{uid(82)}' WHERE id='{root}';", f"UPDATE public.training_modules SET product_id='{club}' WHERE id='{root}';"),
    ]
    for modify, restore in mutations:
        sql(modify)
        check(gate(), 'false', 'runtime prerequisite drift fails closed')
        check(f"SELECT public.user_has_training_lesson_access('{u}','{lesson}')::text;", 'false', 'server drift fails closed')
        sql(restore)
    sql(f"UPDATE public.subscriptions_v2 SET access_end_at='{end}'::timestamptz+interval '2 months';")
    check(f"SELECT valid_until::text FROM private.club_paid_lesson_corrections;", end, 'source renewal cannot extend correction')
    sql(f"UPDATE public.subscriptions_v2 SET access_end_at='{end}';")
    for role in ['anon', 'authenticated', 'service_role', 'sandbox_exec_hdjgkjceownmmnrqqtuz']:
        denied(f'SET ROLE {role}; SELECT * FROM private.club_paid_lesson_corrections;', 'no direct table access')
    check('SELECT count(*) FROM private.club_paid_lesson_corrections;', 1, 'one correction retained')
    current = value("SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(x)) FROM public.payments_v2 x),(SELECT jsonb_agg(to_jsonb(x)) FROM public.subscriptions_v2 x),(SELECT jsonb_agg(to_jsonb(x)) FROM public.orders_v2 x));")
    require(current == baseline, 'no final financial/subscription/order mutation')
    denied(SCRIPT, 'repeat migration stops without changing existing evidence')
    check('SELECT count(*) FROM private.club_paid_lesson_correction_audit;', 1, 'repeat migration atomic/no extra audit')
    print(json.dumps({'postgres': 'PASS', 'assertions': checks, 'fixture': 'synthetic only'}))


if __name__ == '__main__':
    main()
