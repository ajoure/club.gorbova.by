#!/usr/bin/env python3
"""Plan or rehearse the complete app/Auth baseline. No COMMIT mode exists.

Source SQL/data remain in memory. Managed schemas, cron/Vault data and source
event triggers are excluded, not declared migrated. Run only after review/CI.
"""
import argparse
import base64
import collections
import datetime as dt
import hashlib
import json
import re
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import psycopg
from psycopg import sql
from pglast import parse_sql

from auth_restore_dryrun import (
    TARGET, IDENTIFIER, GateFailed, credentials, fingerprint,
    preflight, scalar, sequence_state, table_count,
)

APP = {'public', 'private', 'referral_private', 'drizzle'}
DDL_KINDS = {
    'CreateSchemaStmt', 'CreateEnumStmt', 'CompositeTypeStmt', 'CreateFunctionStmt',
    'CreateStmt', 'ViewStmt', 'CreateSeqStmt', 'AlterSeqStmt', 'AlterTableStmt',
    'IndexStmt', 'CreateTrigStmt', 'CreatePolicyStmt', 'AlterPolicyStmt',
    'GrantStmt', 'AlterDefaultPrivilegesStmt', 'CommentStmt', 'AlterPublicationStmt',
}
COPY_APP = re.compile(rb'^COPY (\w+)\.(\w+) \((.*?)\) FROM stdin;\s*$')


class DiskGuard:
    """Bounded in-process checks, not a persistent monitor or resize service."""
    def __init__(self, initial):
        result = subprocess.run(['security', 'find-generic-password', '-s',
                                 'Supabase CLI', '-w'], capture_output=True, text=True)
        if result.returncode:
            raise GateFailed('disk_api_keychain_unavailable')
        self.token = result.stdout.strip()
        if self.token.startswith('go-keyring-base64:'):
            self.token = base64.b64decode(self.token.split(':', 1)[1]).decode()
        self.last_request = self.last_check = 0.0
        self.maximum_fraction = 0.0
        self.initial_fs = initial['filesystem']['fs_size_bytes']
        self.checks = 0
        config = self.get('')
        if config['attributes']['size_gb'] != 8:
            raise GateFailed('unexpected_disk_allocation')
        self.check(force=True)

    def get(self, suffix):
        # Stay below the Management API request budget; no DDL/COPY progresses
        # while a forced measurement is pending. No retries with a stale value.
        time.sleep(max(0, 0.60 - (time.monotonic() - self.last_request)))
        request = urllib.request.Request(
            'https://api.supabase.com/v1/projects/' + TARGET + '/config/disk' + suffix,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                result = json.load(response)
        except Exception:
            raise GateFailed('disk_metric_unavailable') from None
        self.last_request = time.monotonic()
        return result

    def check(self, force=False):
        # Lightweight catalog DDL is checked at most two seconds apart. Data
        # chunks and nonempty-table index builds always force fresh metrics.
        if not force and time.monotonic() - self.last_check < 2:
            return
        measurement = self.get('/util')
        timestamp = dt.datetime.fromisoformat(measurement['timestamp'].replace('Z', '+00:00'))
        age = (dt.datetime.now(dt.timezone.utc) - timestamp).total_seconds()
        metrics = measurement['metrics']
        if not -5 <= age <= 30 or metrics['fs_size_bytes'] != self.initial_fs:
            raise GateFailed('stale_metric_or_disk_resize')
        fraction = metrics['fs_used_bytes'] / metrics['fs_size_bytes']
        self.maximum_fraction = max(self.maximum_fraction, fraction)
        self.last_check = time.monotonic()
        self.checks += 1
        if fraction >= 0.70:
            raise GateFailed('disk_budget_threshold')


def load_json(path):
    return json.loads(path.read_text())


def heavy_ddl(kind, node, app_rows):
    relation = getattr(node, 'relation', None)
    key = (relation.schemaname or 'public') + '.' + relation.relname if relation else ''
    if not app_rows.get(key, 0):
        return False  # Empty indexes add bounded catalog pages, not a bulk build.
    if kind == 'IndexStmt':
        return True
    if kind == 'AlterTableStmt':
        return any(type(getattr(cmd, 'def_', None)).__name__ == 'Constraint'
                   and cmd.def_.contype.name in {'CONSTR_PRIMARY', 'CONSTR_UNIQUE', 'CONSTR_EXCLUSION'}
                   for cmd in node.cmds)
    return False


def required_copy_columns(cur):
    cur.execute("SELECT n.nspname,c.relname,a.attname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN ('auth','public','private','referral_private','drizzle') AND a.attnum>0 AND NOT a.attisdropped AND (a.attidentity<>'' OR pg_get_expr(d.adbin,d.adrelid) LIKE 'nextval(%')")
    required = collections.defaultdict(set)
    for namespace, table, column in cur.fetchall():
        required[namespace + '.' + table].add(column)
    return required


def dump(args, toc, section=None, data=False):
    command = [str(args.pg_restore), '--no-owner', '--use-list', str(toc), '--file', '-']
    if section:
        command += ['--section', section]
    if data:
        command += ['--data-only']
    command.append(str(args.archive))
    return command


def ddl_statements(content):
    # pglast 8 normalizes RawStmt offsets to Python character positions.
    # Keep the dependency pinned and verify a Cyrillic statement boundary.
    key = re.search(rb'^\\restrict ([a-zA-Z0-9]+)$', content, re.M)
    if key:
        for command in (b'\\restrict ', b'\\unrestrict '):
            content = re.sub(rb'^' + re.escape(command + key[1]) + rb'\s*$', b'', content, flags=re.M)
    content = content.decode('utf-8')
    for raw in parse_sql(content):
        kind = type(raw.stmt).__name__
        start = raw.stmt_location
        end = start + raw.stmt_len if raw.stmt_len else len(content)
        text = content[start:end]
        if kind == 'VariableSetStmt':
            continue  # Never let dump SET/RESET override local safety settings.
        if kind == 'SelectStmt' and re.search(r"SELECT\s+pg_catalog\.set_config\('search_path',\s*'',\s*false\)", text):
            continue
        if kind not in DDL_KINDS:
            raise GateFailed('unsupported_schema_statement_' + kind)
        yield kind, text, raw.stmt


def catalog(cur):
    # Metadata only. Captures existing app objects/default ACLs and managed
    # counters; callers compare before/after rollback, never persist SQL bodies.
    cur.execute("""SELECT jsonb_build_object(
      'namespaces',(SELECT coalesce(jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl::text) ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname IN ('public','private','referral_private','drizzle','pgmq')),
      'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl::text) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','referral_private','drizzle')),
      'routines',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.oid,p.proacl::text) ORDER BY p.oid),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private','referral_private','drizzle')),
      'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_array(d.defaclrole,d.defaclnamespace,d.defaclobjtype,d.defaclacl::text) ORDER BY d.oid),'[]') FROM pg_default_acl d),
      'extensions',(SELECT jsonb_agg(jsonb_build_array(extname,extversion) ORDER BY extname) FROM pg_extension),
      'auth_history',(SELECT count(*) FROM auth.schema_migrations),
      'cron',(SELECT count(*) FROM cron.job),
      'http_queue',(SELECT count(*) FROM net.http_request_queue),
      'vault',(SELECT count(*) FROM vault.secrets),
      'storage_objects',(SELECT count(*) FROM storage.objects),
      'auth_triggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND NOT t.tgisinternal))""")
    return cur.fetchone()[0]


def plan(args, temp):
    manifest, auth, app, budget = map(load_json, [args.objects, args.auth_manifest, args.app_baseline, args.capacity])
    if auth['target'] != TARGET or app['archive_sha256'] != auth['sha256']:
        raise GateFailed('wrong_manifest_scope')
    with args.archive.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != auth['sha256']:
            raise GateFailed('wrong_archive_checksum')
    objects = manifest['objects']
    selected = []
    for obj in objects:
        namespace, kind, identity = obj['schema'], obj['type'], obj['identity']
        if namespace in APP and kind not in {'TABLE DATA', 'SEQUENCE SET'}:
            selected.append(obj)
        elif namespace == '-' and kind == 'SCHEMA' and identity.split()[0] in APP - {'public'}:
            selected.append(obj)
        elif namespace == '-' and kind == 'ACL' and identity.startswith('SCHEMA ') and identity.split()[1] in APP:
            selected.append(obj)
        elif namespace == 'auth' and kind == 'TRIGGER':
            if not identity.startswith('users on_auth_user_created '):
                raise GateFailed('unreviewed_auth_trigger')
            selected.append(obj)
    schema_list = temp / 'schema.list'
    schema_list.write_text('\n'.join(str(o['toc_id']) + ';' for o in selected) + '\n')
    phases = {}
    for section in ('pre-data', 'post-data'):
        result = subprocess.run(dump(args, schema_list, section=section), capture_output=True)
        if result.returncode:
            raise GateFailed('schema_extract_failed')
        phases[section] = list(ddl_statements(result.stdout))
    app_data = [o for o in objects if o['schema'] in APP and o['type'] == 'TABLE DATA']
    app_keys = {o['schema'] + '.' + o['identity'].split()[0] for o in app_data}
    if len(app_data) != 402 or app_keys != set(app['rows_by_table']):
        raise GateFailed('incomplete_app_table_set')
    auth_data = auth['data_order']
    if len(auth_data) != 26 or 'schema_migrations' in {o['table'] for o in auth_data}:
        raise GateFailed('invalid_auth_table_set')
    for label, rows in [('auth', auth_data), ('app', app_data)]:
        (temp / (label + '.list')).write_text('\n'.join(str(o['toc_id']) + ';' for o in rows) + '\n')
    seq_objects = [o for o in objects if o['schema'] in APP and o['type'] == 'SEQUENCE SET']
    seq_list = temp / 'sequences.list'
    seq_list.write_text('\n'.join(str(o['toc_id']) + ';' for o in seq_objects) + '\n')
    seq_result = subprocess.run(dump(args, seq_list, data=True), capture_output=True)
    if seq_result.returncode:
        raise GateFailed('sequence_extract_failed')
    matches = re.findall(rb"SELECT pg_catalog\.setval\('([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)', ([0-9]+), (true|false)\);", seq_result.stdout)
    if len(matches) != len(seq_objects) or any(x[0].decode() not in APP for x in matches):
        raise GateFailed('unrecognized_app_sequence_values')
    phases['sequence_values'] = [(ns.decode(), name.decode(), int(value), called == b'true')
                                for ns, name, value, called in matches]
    return phases, auth, app, budget


def copy_load(args, cur, toc, expected, disk, headers, required):
    process = subprocess.Popen(dump(args, toc, data=True), stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    seen = set()
    try:
        for line in process.stdout:
            match = COPY_APP.match(line)
            if not match:
                continue  # Ignore dump SQL. Only validated COPY payloads enter DB.
            key = match[1].decode() + '.' + match[2].decode()
            names = [x.strip().strip('"') for x in match[3].decode().split(',')]
            if key not in expected or key in seen or any(not IDENTIFIER.fullmatch(x) for x in names):
                raise GateFailed('unexpected_copy_header')
            if not required.get(key, set()).issubset(names):
                raise GateFailed('sequence_default_would_run')
            namespace, table = key.split('.')
            statement = sql.SQL('COPY {}.{} ({}) FROM STDIN').format(
                sql.Identifier(namespace), sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, names)))
            disk.check()
            count = buffered = 0
            terminated = False
            with cur.copy(statement) as copy:
                for row in process.stdout:
                    if row.rstrip(b'\n') == b'\\.':
                        terminated = True
                        break
                    copy.write(row)
                    count += 1
                    buffered += len(row)
                    if buffered >= 64 * 1024 * 1024:
                        disk.check(force=True)
                        buffered = 0
            if not terminated or count != expected[key]:
                raise GateFailed('copy_row_count_mismatch')
            headers[key] = names
            seen.add(key)
            disk.check()
            if args.inject_failure == 'first-app-table' and namespace in APP:
                raise GateFailed('injected_failure')
        if process.wait(timeout=30) or seen != set(expected):
            raise GateFailed('incomplete_data_stream')
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=10)


def execute(args, temp, phases, auth, app, budget, report):
    disk = DiskGuard(budget)
    baseline = load_json(args.auth_baseline)
    auth_tables = [x['table'] for x in auth['data_order']]
    conn = psycopg.connect(**credentials(args.cli_workdir), sslmode='verify-full',
                          sslrootcert=str(args.ca), connect_timeout=15, autocommit=True,
                          application_name='gorbova-copy-full-rollback-only')
    before = sequences = None
    try:
        with conn.cursor() as cur:
            cur.execute('BEGIN')
            report['advisory_lock_acquired'] = preflight(cur, auth_tables)
            before, sequences = catalog(cur), sequence_state(cur)
            if any(before[k] for k in ('cron', 'http_queue', 'vault', 'storage_objects')):
                raise GateFailed('target_not_isolated')
            if any(x[0] != 'public' for x in before['namespaces']):
                raise GateFailed('target_private_or_queue_schema_already_present')
            if not scalar(cur, 'SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user'):
                raise GateFailed('verification_role_must_bypass_rls')
            cur.execute("SET LOCAL check_function_bodies=false")
            cur.execute("SET LOCAL standard_conforming_strings=on")
            cur.execute("CREATE EXTENSION pgmq VERSION '1.5.1'")
            for kind, statement, node in phases['pre-data']:
                disk.check()
                cur.execute(statement)
                disk.check()
            report['pre_data_completed'] = True
            required = required_copy_columns(cur)
            headers = {}
            auth_expected = {'auth.' + x['table']: x['snapshot_rows'] for x in auth['data_order']}
            copy_load(args, cur, temp / 'auth.list', auth_expected, disk, headers, required)
            copy_load(args, cur, temp / 'app.list', app['rows_by_table'], disk, headers, required)
            report['data_loaded_rows'] = sum(auth_expected.values()) + sum(app['rows_by_table'].values())
            for namespace, name, value, called in phases['sequence_values']:
                # All app relations were absent before this transaction. A setval
                # on these newly created objects disappears with their rollback.
                if any(row[0] == namespace and row[1] == name for row in before['relations']):
                    raise GateFailed('refusing_to_change_existing_sequence')
                kind = scalar(cur, 'SELECT relkind FROM pg_class WHERE oid=%s::regclass', (namespace + '.' + name,))
                if kind != 'S':
                    raise GateFailed('app_sequence_missing')
                scalar(cur, 'SELECT pg_catalog.setval(%s::regclass,%s,%s)', (namespace + '.' + name, value, called))
            for kind, statement, node in phases['post-data']:
                heavy = heavy_ddl(kind, node, app['rows_by_table'])
                disk.check(force=heavy)
                cur.execute(statement)
                disk.check(force=heavy)
            cur.execute('SET CONSTRAINTS ALL IMMEDIATE')
            for namespace, name, value, called in phases['sequence_values']:
                cur.execute(sql.SQL('SELECT last_value,is_called FROM {}.{}').format(sql.Identifier(namespace), sql.Identifier(name)))
                if cur.fetchone() != (value, called):
                    raise GateFailed('app_sequence_roundtrip_mismatch')
            report['new_app_sequences_verified'] = len(phases['sequence_values'])
            expected = auth_expected | app['rows_by_table']
            hashes = {'auth.' + k: v for k, v in baseline['row_multiset_sha256_sums'].items()} | app['row_multiset_sha256_sums']
            verified = 0
            for key in expected:
                namespace, table = key.split('.')
                statement = sql.SQL('COPY {}.{} ({}) TO STDOUT').format(
                    sql.Identifier(namespace), sql.Identifier(table), sql.SQL(',').join(map(sql.Identifier, headers[key])))
                with cur.copy(statement) as copy:
                    count, digest = fingerprint(copy)
                if count != expected[key] or digest != hashes.get(key, '0' * 64):
                    raise GateFailed('roundtrip_mismatch')
                verified += 1
                disk.check()
            cur.execute('SELECT id::text,encrypted_password FROM auth.users')
            pairs = ['\t'.join(row) for row in cur.fetchall()]
            if hashlib.sha256('\n'.join(sorted(pairs)).encode()).hexdigest() != baseline['uuid_password_pair_fingerprint']:
                raise GateFailed('uuid_password_mismatch')
            if sequence_state(cur) != sequences or scalar(cur, 'SELECT count(*) FROM cron.job') or scalar(cur, 'SELECT count(*) FROM net.http_request_queue'):
                raise GateFailed('unexpected_sequence_or_queued_effect')
            report.update(roundtrip_tables_verified=verified, uuid_password_match=True, passed=True)
    except Exception as exc:
        report.update(passed=False, error_class=type(exc).__name__, sqlstate=getattr(exc, 'sqlstate', None))
        if isinstance(exc, GateFailed):
            report['gate'] = str(exc)
            report['injected_failure_triggered'] = str(exc) == 'injected_failure'
    finally:
        conn.rollback()
        try:
            with conn.cursor() as cur:
                cur.execute('BEGIN READ ONLY')
                cur.execute('SET LOCAL ROLE postgres')
                report['catalog_unchanged'] = before is not None and catalog(cur) == before
                report['auth_sequences_unchanged'] = sequences is not None and sequence_state(cur) == sequences
                report['after_rollback_auth_rows'] = sum(table_count(cur, table) for table in auth_tables)
                report['advisory_lock_released'] = scalar(cur, "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid()") == 0
                report['rollback_verified'] = report['catalog_unchanged'] and report['auth_sequences_unchanged'] and report['after_rollback_auth_rows'] == 0 and report['advisory_lock_released']
                scenario = report.get('passed', False) if args.inject_failure is None else report.get('injected_failure_triggered', False)
                report['passed'] = scenario and report['rollback_verified']
        finally:
            conn.rollback()
            conn.close()
        report['disk_checks'] = disk.checks
        report['maximum_disk_fraction_observed'] = disk.maximum_fraction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('archive', 'objects', 'auth-manifest', 'auth-baseline', 'app-baseline',
                 'capacity', 'pg-restore', 'cli-workdir', 'ca', 'temp-dir', 'report'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--run-rollback-rehearsal', action='store_true')
    parser.add_argument('--inject-failure', choices=['first-app-table'])
    args = parser.parse_args()
    if args.report.exists():
        print(json.dumps({'passed': False, 'gate': 'report_already_exists', 'database_connected': False}))
        return 1
    report = dict(target=TARGET, mode='plan_only', commit_supported=False,
                  raw_sql_or_rows_persisted=False, credentials_printed=False, passed=False)
    try:
        with tempfile.TemporaryDirectory(prefix='full-rehearsal-', dir=args.temp_dir) as td:
            temp = Path(td)
            phases, auth, app, budget = plan(args, temp)
            report['schema_statement_kinds'] = {phase: dict(collections.Counter(x[0] for x in phases[phase])) for phase in ('pre-data', 'post-data')}
            report['schema_statement_hashes'] = {phase: hashlib.sha256('\n'.join(x[1] for x in phases[phase]).encode()).hexdigest() for phase in ('pre-data', 'post-data')}
            report['planned_heavy_ddl_checks'] = sum(heavy_ddl(kind, node, app['rows_by_table']) for kind, _, node in phases['post-data'])
            report['planned_app_sequence_values'] = len(phases['sequence_values'])
            report['planned_app_tables'] = len(app['rows_by_table'])
            report['planned_total_rows'] = sum(app['rows_by_table'].values()) + sum(x['snapshot_rows'] for x in auth['data_order'])
            if args.run_rollback_rehearsal:
                report['mode'] = 'rollback_only'
                execute(args, temp, phases, auth, app, budget, report)
            else:
                report.update(passed=True, database_connected=False)
    except Exception as exc:
        report.update(passed=False, error_class=type(exc).__name__, sqlstate=getattr(exc, 'sqlstate', None))
        if isinstance(exc, GateFailed):
            report['gate'] = str(exc)
    with args.report.open('x') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
