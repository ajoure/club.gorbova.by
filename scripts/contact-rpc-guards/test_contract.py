#!/usr/bin/env python3
"""Real PostgreSQL regression contracts; production connections are forbidden."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CONTRACT = json.loads((HERE / "contract.json").read_text())
MIGRATION = ROOT / "supabase/migrations/20261105131619_guard_contact_list_rpc_access.sql"
SQL = MIGRATION.read_text()
BASELINE = (HERE / "baseline-functions.sql").read_text()
HELPER = (HERE / "canonical-helper.sql").read_text()
FUNCTIONS = CONTRACT["functions"]
TECHNICAL_ROLE = CONTRACT["technical_role"]
UID = {name: f"00000000-0000-0000-0000-{number:012d}" for name, number in {
    "user": 1001, "staff_no_grant": 1002, "view": 1003, "edit": 1004,
    "manage": 1005, "admin": 1006, "super_admin": 1007,
}.items()}


def literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def definition(source: str, name: str) -> tuple[str, str]:
    found = re.search(
        r"CREATE OR REPLACE FUNCTION public\." + re.escape(name)
        + r"\(.*?\bAS\s+(\$[\w]*\$)(.*?)\1;", source, re.S | re.I,
    )
    assert found, name
    return found.group(0), found.group(2)


def static_checks() -> None:
    assert len(FUNCTIONS) == 4
    assert hashlib.md5(definition(HELPER, "has_admin_section_access")[1].encode()).hexdigest() == CONTRACT["helper_body_md5"]
    for index, rule in enumerate(FUNCTIONS, 1):
        assert hashlib.md5(definition(BASELINE, rule["name"])[1].encode()).hexdigest() == rule["old_body_md5"]
        block = re.search(rf"EXECUTE \$secured_{index}\$(.*?)\$secured_{index}\$;", SQL, re.S)
        assert block, rule["name"]
        assert hashlib.md5(definition(block.group(1), rule["name"])[1].encode()).hexdigest() == rule["new_body_md5"]
    print("PASS static: four complete baseline/new body hashes and canonical helper agree; PostgreSQL execution still required")


class Database:
    def __init__(self) -> None:
        env = os.environ.copy()
        if env.get("CONTACT_RPC_GUARD_FIXTURE") != "1" or env.get("PGDATABASE") != "contact_rpc_guard_test" or env.get("PGHOST") not in {"127.0.0.1", "localhost"} or env.get("PGUSER") != "postgres":
            raise RuntimeError("Only the explicit loopback synthetic contact_rpc_guard_test fixture is allowed")
        env.pop("PGSERVICE", None)
        env.pop("PGSERVICEFILE", None)
        env.pop("PGOPTIONS", None)
        env["PGCONNECT_TIMEOUT"] = "5"
        self.env = env
        self.command = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-h", env["PGHOST"], "-p", env.get("PGPORT", "5432"), "-U", "postgres", "-d", "contact_rpc_guard_test"]

    def call(self, sql: str, denied: bool = False) -> str:
        result = subprocess.run(self.command, input=sql, text=True, capture_output=True, env=self.env, timeout=30)
        if denied:
            assert result.returncode != 0, "Denied actor unexpectedly received data"
            assert re.search(r"ERROR:\s+42501:", result.stderr), "Unexpected SQL failure, not a passing denial: " + result.stderr[-2500:]
            return ""
        assert result.returncode == 0, result.stderr[-3500:]
        return result.stdout.strip()

    def json(self, sql: str) -> object:
        return json.loads(self.call(sql))


def actor(sql: str, uid: str | None, role: str = "authenticated", prefix: str = "") -> str:
    assert role in {"authenticated", "anon", "service_role", TECHNICAL_ROLE}
    return f"BEGIN; {prefix} SET LOCAL ROLE {role}; SET LOCAL test.uid={literal(uid or '')}; {sql} ROLLBACK;"


def old_acls() -> str:
    commands = []
    for rule in FUNCTIONS:
        signature = rule["signature"]
        commands.append(f"REVOKE ALL ON FUNCTION {signature} FROM PUBLIC, anon;")
        commands.append(f"GRANT EXECUTE ON FUNCTION {signature} TO authenticated, service_role, {TECHNICAL_ROLE};")
        if rule["old_public_anon"]:
            commands.append(f"GRANT EXECUTE ON FUNCTION {signature} TO PUBLIC, anon;")
    return "\n".join(commands)


def snapshot_expression() -> str:
    signatures = ",".join(f"to_regprocedure({literal(rule['signature'])})" for rule in FUNCTIONS)
    return f"""(SELECT jsonb_agg(jsonb_build_object(
      'oid',p.oid,'body',md5(p.prosrc),'definition',md5(pg_get_functiondef(p.oid)),
      'acl',p.proacl::text,'owner',p.proowner,'xmin',p.xmin::text) ORDER BY p.oid)
      FROM pg_proc p WHERE p.oid IN ({signatures},to_regprocedure('public.has_admin_section_access(uuid,text,text)')))"""


def query_result(search: str | None, limit: int = 100, offset: int = 0) -> str:
    search_sql = "NULL" if search is None else literal(search)
    return f"""SELECT jsonb_build_object(
      'duplicates',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'ordinality' ORDER BY r.ordinality),'[]'::jsonb)
        FROM public.get_duplicate_contact_profiles({limit},{offset},{search_sql}) WITH ORDINALITY r),
      'paid',(SELECT coalesce(jsonb_agg(to_jsonb(r)-'ordinality' ORDER BY r.ordinality),'[]'::jsonb)
        FROM public.get_profiles_with_paid_orders({limit},{offset},{search_sql}) WITH ORDINALITY r),
      'tabs',public.get_contact_tab_counts({search_sql}),
      'paid_count',public.get_profiles_with_paid_orders_count({search_sql}));"""


def data_fingerprint(db: Database) -> object:
    parts = ",".join(f"{literal(name)},(SELECT md5(coalesce(string_agg(to_jsonb(t)::text,',' ORDER BY to_jsonb(t)::text),'')) FROM public.{name} t)" for name in ["profiles", "orders_v2", "companies", "company_contacts", "fixture_roles", "fixture_grants"])
    return db.json(f"SELECT jsonb_build_object({parts},'membership_count',(SELECT count(*) FROM pg_auth_members));")


def expected_drift_failure(db: Database, mutation: str, migration: str = SQL) -> None:
    # The exception subtransaction rolls back every migration action. Only the
    # precise, intentional preflight SQLSTATE/message is accepted as success.
    db.call(f"""BEGIN;
      {BASELINE}
      {old_acls()}
      {HELPER}
      {mutation}
      DO $test_drift$
      DECLARE v_before jsonb; v_after jsonb; v_caught boolean := false; v_message text;
      BEGIN
        v_before := {snapshot_expression()};
        BEGIN
          EXECUTE {literal(migration)};
        EXCEPTION WHEN SQLSTATE '55000' THEN
          GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
          IF v_message NOT LIKE 'contact_rpc_guard_preflight:%' THEN RAISE; END IF;
          v_caught := true;
        END;
        v_after := {snapshot_expression()};
        IF NOT v_caught OR v_before IS DISTINCT FROM v_after THEN
          RAISE EXCEPTION 'Drift did not stop atomically';
        END IF;
      END;
      $test_drift$;
      ROLLBACK;""")


def real_contracts() -> None:
    db = Database()
    db.call((HERE / "fixture.sql").read_text() + "\n" + HELPER + "\n" + BASELINE + "\n" + old_acls() + """
      CREATE VIEW public.fixture_duplicate_dependency AS SELECT id FROM public.get_duplicate_contact_profiles(100,0,NULL);
      CREATE VIEW public.fixture_paid_dependency AS SELECT profile_id FROM public.get_profiles_with_paid_orders(100,0,NULL);
      GRANT SELECT ON public.fixture_duplicate_dependency, public.fixture_paid_dependency TO authenticated;
    """)
    assert db.call("SELECT marker FROM public.fixture_safety_marker;") == "synthetic-contact-rpc-only"
    assert db.call(actor("SELECT count(*) FROM public.profiles;", UID["user"])) == "0", "Fixture RLS must deny direct table rows"
    cases = [(None, 100, 0), (None, 1, 0), (None, 1, 1), ("Fixture Company", 100, 0), ("ALPHA", 100, 0), ("' OR true --", 100, 0), (None, 0, 0)]
    baseline = [db.json(actor(query_result(search, limit, offset), UID["user"])) for search, limit, offset in cases]
    assert len(baseline[0]["duplicates"]) == 2 and len(baseline[0]["paid"]) == 3, "Old vulnerable RPC must expose synthetic rows despite fixture RLS"
    assert len(baseline[0]["paid"][0]) == 24
    assert [row["loyalty_score"] for row in baseline[0]["paid"]] == [-2, None, 5]
    assert db.call("SELECT pg_typeof(loyalty_score)::text FROM public.profiles LIMIT 1;") == "integer"
    assert db.call("SELECT pg_typeof(loyalty_score)::text FROM public.get_profiles_with_paid_orders(1,0,NULL);") == "numeric"
    before_data = data_fingerprint(db)
    before_oids = db.json("SELECT jsonb_agg(oid ORDER BY oid) FROM pg_proc WHERE oid IN (" + ",".join(f"to_regprocedure({literal(r['signature'])})" for r in FUNCTIONS) + ");")
    before_views = db.call("SELECT 'public.fixture_duplicate_dependency'::regclass::oid||':'||'public.fixture_paid_dependency'::regclass::oid;")
    db.call(SQL)
    assert data_fingerprint(db) == before_data, "Migration must not change fixture/client/role data"

    for role_name in ["view", "edit", "manage", "admin", "super_admin"]:
        actual = [db.json(actor(query_result(search, limit, offset), UID[role_name])) for search, limit, offset in cases]
        assert actual == baseline, f"Query shape, search, order, counts or paging changed for {role_name}"
    defaults = db.json(actor("SELECT jsonb_build_object('duplicates',(SELECT count(*) FROM public.get_duplicate_contact_profiles()),'tabs',public.get_contact_tab_counts(),'paid_count',public.get_profiles_with_paid_orders_count());", UID["view"]))
    assert defaults["duplicates"] == 2 and defaults["paid_count"] == 3 and defaults["tabs"] == baseline[0]["tabs"]
    print("PASS PostgreSQL: identical query results, 24 paid columns, company search, ordering, pagination, defaults and counts for view/edit/manage/admin/super_admin")

    calls = ["SELECT * FROM public.get_duplicate_contact_profiles(0,0,NULL);", "SELECT * FROM public.get_profiles_with_paid_orders(0,0,NULL);", "SELECT public.get_contact_tab_counts(NULL);", "SELECT public.get_profiles_with_paid_orders_count(NULL);"]
    for role, uid in [("anon", None), ("authenticated", None), ("authenticated", UID["user"]), ("authenticated", UID["staff_no_grant"]), ("service_role", None), (TECHNICAL_ROLE, None)]:
        for call in calls:
            db.call(actor(call, uid, role), denied=True)
    for call in calls:
        db.call(actor(call, UID["user"], prefix="ALTER TABLE public.profiles RENAME TO fixture_profiles_guard_trap;"), denied=True)
    db.call(actor("SELECT * FROM public.fixture_duplicate_dependency;", UID["user"]), denied=True)
    print("PASS PostgreSQL: anon/user/staff without contacts/null uid/service and sandbox without uid denied with exact 42501; guard precedes data-query preparation")

    for rule in FUNCTIONS:
        privileges = db.json(f"SELECT jsonb_build_object('anon',has_function_privilege('anon',{literal(rule['signature'])},'EXECUTE'),'authenticated',has_function_privilege('authenticated',{literal(rule['signature'])},'EXECUTE'),'service',has_function_privilege('service_role',{literal(rule['signature'])},'EXECUTE'),'technical',has_function_privilege({literal(TECHNICAL_ROLE)},{literal(rule['signature'])},'EXECUTE'));")
        assert privileges == {"anon": False, "authenticated": True, "service": True, "technical": True}
    after_oids = db.json("SELECT jsonb_agg(oid ORDER BY oid) FROM pg_proc WHERE oid IN (" + ",".join(f"to_regprocedure({literal(r['signature'])})" for r in FUNCTIONS) + ");")
    assert before_oids == after_oids
    assert before_views == db.call("SELECT 'public.fixture_duplicate_dependency'::regclass::oid||':'||'public.fixture_paid_dependency'::regclass::oid;")
    assert len(db.json(actor("SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM public.fixture_duplicate_dependency;", UID["view"]))) == 2
    first_application = db.json("SELECT " + snapshot_expression() + ";")
    db.call(SQL)
    assert db.json("SELECT " + snapshot_expression() + ";") == first_application, "Second application must not even rewrite pg_proc rows"
    assert data_fingerprint(db) == before_data
    print("PASS PostgreSQL: exact ACL, technical grants, owner/dependencies/OIDs retained; second apply is a full verified no-op, no data or membership changes")

    old_dup = definition(BASELINE, "get_duplicate_contact_profiles")[0]
    expected_drift_failure(db, old_dup.replace("AS $$", "AS $$\n-- synthetic body drift\n", 1))
    expected_drift_failure(db, HELPER.replace("AS $$", "AS $$\n-- synthetic helper drift\n", 1))
    expected_drift_failure(db, "GRANT EXECUTE ON FUNCTION public.get_contact_tab_counts(text) TO anon;")
    expected_drift_failure(db, old_dup.replace("DEFAULT 100", "DEFAULT 99", 1))
    expected_drift_failure(db, "ALTER FUNCTION public.get_contact_tab_counts(text) SET search_path=public,pg_catalog;")
    expected_drift_failure(db, "ALTER FUNCTION public.get_contact_tab_counts(text) OWNER TO service_role;")
    first_new = re.search(r"EXECUTE \$secured_1\$(.*?)\$secured_1\$;", SQL, re.S).group(1)
    expected_drift_failure(db, first_new + "REVOKE EXECUTE ON FUNCTION public.get_duplicate_contact_profiles(integer,integer,text) FROM PUBLIC,anon;")
    expected_drift_failure(db, "", SQL.replace("Forbidden: contacts view required", "Synthetic changed postcheck body", 1))
    assert db.json("SELECT " + snapshot_expression() + ";") == first_application
    assert data_fingerprint(db) == before_data
    print("PASS PostgreSQL: body/helper/ACL/default/path/owner/mixed-state drift and post-DDL failure all abort atomically; unexpected SQL failures are never accepted")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--static", action="store_true", help="Only local source/hash consistency; does not prove SQL or role behavior")
    args = parser.parse_args()
    static_checks()
    if not args.static:
        real_contracts()
