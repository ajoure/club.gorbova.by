#!/usr/bin/env python3
"""Rehearse a reviewed Auth snapshot in the isolated target; ALWAYS ROLLBACK.

Requires the pinned dependency in auth_restore_requirements.txt.
No commit mode exists. Archive rows and credentials stay in process memory.
"""
import argparse
import collections
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tempfile

import psycopg
from psycopg import sql

TARGET = 'ypwsuumurrtkxatoyqhk'
COPY = re.compile(r'^COPY auth\.(\w+) \((.*?)\) FROM stdin;\s*$')
IDENTIFIER = re.compile(r'^[a-z_][a-z0-9_]*$')


class GateFailed(Exception):
    """A failed aggregate gate; exception messages must never contain row values."""


def credentials(workdir):
    if (workdir / 'supabase/.temp/project-ref').read_text().strip() != TARGET:
        raise GateFailed('wrong_linked_project')
    env = os.environ.copy()
    for key in ('SUPABASE_DB_PASSWORD', 'PGPASSWORD', 'DATABASE_URL', 'PGHOST',
                'PGUSER', 'PGDATABASE', 'PGPORT', 'PGSERVICE', 'PGSERVICEFILE', 'PGOPTIONS'):
        env.pop(key, None)
    result = subprocess.run(
        ['supabase', 'db', 'dump', '--linked', '--dry-run', '--workdir', str(workdir)],
        env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise GateFailed('cli_login_failed')
    fields = {}
    for line in result.stdout.splitlines():
        match = re.match(r'^\s*(?:export\s+)?(PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE)=(.*)$', line)
        if match:
            value = shlex.split(match[2])
            if len(value) != 1:
                raise GateFailed('unexpected_cli_credential_format')
            fields[match[1]] = value[0]
    if set(fields) != {'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'}:
        raise GateFailed('incomplete_cli_connection')
    if not (fields['PGHOST'].endswith('.pooler.supabase.com')
            and fields['PGUSER'].endswith('.' + TARGET)
            and fields['PGDATABASE'] == 'postgres' and fields['PGPORT'] == '5432'):
        raise GateFailed('unexpected_target_route')
    return dict(host=fields['PGHOST'], port=fields['PGPORT'], user=fields['PGUSER'],
                password=fields['PGPASSWORD'], dbname=fields['PGDATABASE'])


def scalar(cur, statement, params=None):
    cur.execute(statement, params)
    return cur.fetchone()[0]


def table_count(cur, table):
    return scalar(cur, sql.SQL('SELECT count(*) FROM auth.{}').format(sql.Identifier(table)))


def sequence_state(cur):
    cur.execute("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND c.relkind='S' ORDER BY c.relname")
    names = [row[0] for row in cur.fetchall()]
    result = {}
    for name in names:
        cur.execute(sql.SQL('SELECT last_value, is_called FROM auth.{}').format(sql.Identifier(name)))
        result[name] = list(cur.fetchone())
    return result


def sequence_columns(cur):
    cur.execute("SELECT c.relname,a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='auth' AND a.attnum>0 AND NOT a.attisdropped AND (a.attidentity<>'' OR pg_get_expr(d.adbin,d.adrelid) LIKE 'nextval(%')")
    result = collections.defaultdict(set)
    for table, column in cur.fetchall():
        result[table].add(column)
    return result


def fingerprint(chunks):
    """Use newline-delimited PostgreSQL COPY text; avoid dependence on row order."""
    count = total = 0
    pending = b''
    for block in chunks:
        pending += bytes(block)
        while b'\n' in pending:
            line, pending = pending.split(b'\n', 1)
            count += 1
            total = (total + int.from_bytes(hashlib.sha256(line + b'\n').digest(), 'big')) % (1 << 256)
    if pending:
        raise GateFailed('incomplete_copy_output')
    return count, format(total, '064x')


def preflight(cur, tables):
    cur.execute('SET LOCAL ROLE postgres')
    cur.execute("SET LOCAL timezone='UTC'")
    cur.execute("SET LOCAL datestyle='ISO, MDY'")
    cur.execute("SET LOCAL intervalstyle='postgres'")
    cur.execute('SET LOCAL extra_float_digits=3')
    cur.execute("SET LOCAL bytea_output='hex'")
    cur.execute("SET LOCAL client_encoding='UTF8'")
    cur.execute("SET LOCAL statement_timeout='120s'")
    cur.execute("SET LOCAL lock_timeout='5s'")
    if not scalar(cur, 'SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'):
        raise GateFailed('backend_tls_required')
    if scalar(cur, "SELECT count(*) FROM pg_tables WHERE schemaname='public'"):
        raise GateFailed('target_application_not_empty')
    if scalar(cur, "SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND NOT t.tgisinternal"):
        raise GateFailed('custom_auth_triggers_present')
    for table in tables:
        if table_count(cur, table):
            raise GateFailed('target_auth_not_empty')
    if not scalar(cur, "SELECT pg_try_advisory_xact_lock(hashtext('gorbova.copy.auth.dryrun.v1'))"):
        raise GateFailed('target_auth_resource_busy')
    return True


def run(args):
    manifest = json.loads(args.manifest.read_text())
    baseline = json.loads(args.baseline.read_text())
    if manifest['target'] != TARGET or not manifest['preserve_target_managed_schema_and_migration_history']:
        raise GateFailed('wrong_manifest')
    with args.archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest['sha256']:
            raise GateFailed('archive_checksum_mismatch')
    ordered = manifest['data_order']
    tables = [item['table'] for item in ordered]
    if len(tables) != 26 or len(set(tables)) != 26 or 'schema_migrations' in tables:
        raise GateFailed('unexpected_auth_table_set')
    if any(not IDENTIFIER.fullmatch(t) for t in tables):
        raise GateFailed('invalid_table_identifier')
    if args.inject_failure_after is not None and args.inject_failure_after not in tables:
        raise GateFailed('invalid_injection_target')
    expected = {item['table']: item['snapshot_rows'] for item in ordered}
    report = dict(target=TARGET, mode='rollback_only', archive_sha256=manifest['sha256'],
                  commit_supported=False, injected_failure_after=args.inject_failure_after,
                  raw_rows_persisted=False, credentials_printed=False, passed=False,
                  injected_failure_triggered=False, advisory_lock_acquired=False)
    connection = psycopg.connect(**credentials(args.cli_workdir), sslmode='verify-full',
                                sslrootcert=str(args.ca), connect_timeout=15,
                                application_name='gorbova-copy-auth-rollback-only', autocommit=True)
    before = migrations_before = None
    loaded = collections.Counter()
    headers = {}
    process = None
    try:
        with connection.cursor() as cur:
            cur.execute('BEGIN')
            report['advisory_lock_acquired'] = preflight(cur, tables)
            before = sequence_state(cur)
            required_sequence_columns = sequence_columns(cur)
            migrations_before = table_count(cur, 'schema_migrations')
            # Never include SEQUENCE SET: setval is not transactional.
            with tempfile.TemporaryDirectory(prefix='auth-dryrun-', dir=args.temp_dir) as td:
                toc = Path(td) / 'data.list'
                toc.write_text('\n'.join(str(item['toc_id']) + ';' for item in ordered) + '\n')
                process = subprocess.Popen(
                    [str(args.pg_restore), '--data-only', '--use-list', str(toc),
                     '--file', '-', str(args.archive)], stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL, text=True, encoding='utf-8')
                observed = []
                for line in process.stdout:
                    match = COPY.match(line)
                    if not match:
                        # Never execute archive SQL, SET, setval, functions, or psql commands.
                        continue
                    table = match[1]
                    if table not in expected or table in headers:
                        raise GateFailed('unexpected_copy_table')
                    names = [s.strip().strip('"') for s in match[2].split(',')]
                    if any(not IDENTIFIER.fullmatch(n) for n in names):
                        raise GateFailed('invalid_copy_column')
                    if not required_sequence_columns[table].issubset(names):
                        raise GateFailed('copy_would_invoke_sequence_default')
                    headers[table] = names
                    observed.append(table)
                    statement = sql.SQL('COPY auth.{} ({}) FROM STDIN').format(
                        sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, names)))
                    terminated = False
                    with cur.copy(statement) as copy:
                        for row in process.stdout:
                            if row.rstrip('\n') == '\\.':
                                terminated = True
                                break
                            copy.write(row)
                            loaded[table] += 1
                    if not terminated or loaded[table] != expected[table]:
                        raise GateFailed('copy_count_mismatch')
                    if args.inject_failure_after == table:
                        report['injected_failure_triggered'] = True
                        raise GateFailed('injected_failure')
                if process.wait(timeout=30) or observed != tables:
                    raise GateFailed('archive_stream_failed_or_reordered')
            cur.execute('SET CONSTRAINTS ALL IMMEDIATE')
            matches = 0
            for table in tables:
                statement = sql.SQL('COPY auth.{} ({}) TO STDOUT').format(
                    sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, headers[table])))
                with cur.copy(statement) as copy:
                    count, digest = fingerprint(copy)
                if count != expected[table] or digest != baseline['row_multiset_sha256_sums'].get(table, '0' * 64):
                    raise GateFailed('roundtrip_fingerprint_mismatch')
                matches += 1
            cur.execute('SELECT id::text, encrypted_password FROM auth.users')
            pairs = ['\t'.join(row) for row in cur.fetchall()]
            digest = hashlib.sha256('\n'.join(sorted(pairs)).encode()).hexdigest()
            if digest != baseline['uuid_password_pair_fingerprint']:
                raise GateFailed('uuid_password_mismatch')
            if sequence_state(cur) != before or table_count(cur, 'schema_migrations') != migrations_before:
                raise GateFailed('managed_state_changed')
            report.update(in_transaction_tables_verified=matches, uuid_password_match=True,
                          in_transaction_rows=sum(expected.values()), passed=True)
    except Exception as exc:
        report['passed'] = False
        report['error_class'] = type(exc).__name__
        report['sqlstate'] = getattr(exc, 'sqlstate', None)
        if isinstance(exc, GateFailed):
            report['gate'] = str(exc)  # Static gate name only; never a database error message.
    finally:
        if process and process.poll() is None:
            # Only our local read-only archive reader is terminated; DB rolls back below.
            process.terminate()
            process.wait(timeout=10)
        connection.rollback()
        try:
            with connection.cursor() as cur:
                cur.execute('BEGIN READ ONLY')
                cur.execute('SET LOCAL ROLE postgres')
                remaining = sum(table_count(cur, table) for table in tables)
                report['after_rollback_auth_rows'] = remaining
                report['sequence_unchanged'] = before is not None and sequence_state(cur) == before
                report['managed_history_unchanged'] = migrations_before is not None and table_count(cur, 'schema_migrations') == migrations_before
                report['advisory_lock_released'] = scalar(cur, "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()") == 0
                report['rollback_verified'] = remaining == 0 and report['sequence_unchanged'] and report['managed_history_unchanged'] and report['advisory_lock_released']
                scenario_pass = report['passed'] if args.inject_failure_after is None else report['injected_failure_triggered'] and report.get('gate') == 'injected_failure'
                report['passed'] = scenario_pass and report['rollback_verified']
        finally:
            connection.rollback()
            connection.close()
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('archive', 'manifest', 'baseline', 'pg-restore', 'cli-workdir', 'ca', 'temp-dir', 'report'):
        parser.add_argument('--' + name, required=True, type=Path)
    parser.add_argument('--inject-failure-after', default=None)
    args = parser.parse_args()
    try:
        return run(args)
    except Exception as exc:
        print(json.dumps({'passed': False, 'error_class': type(exc).__name__,
                          'sqlstate': getattr(exc, 'sqlstate', None), 'raw_error_suppressed': True}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
