#!/usr/bin/env python3
"""Plan or rehearse the complete app/Auth baseline. No COMMIT mode exists.

Source SQL/data remain in memory. Managed schemas, cron/Vault data and source
event triggers are excluded, not declared migrated. Run only after review/CI.
"""
import argparse
import collections
import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

import psycopg
from psycopg import sql
from pglast import parse_sql
from pglast.stream import RawStream
from pglast.visitors import Visitor
from migration_disk_guard import DiskGuard

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
PLATFORM_ROLES = frozenset({'sandbox_exec', 'sandbox_exec_hdjgkjceownmmnrqqtuz'})


def role_names(node):
    names = collections.Counter()
    class Roles(Visitor):
        def visit_RoleSpec(self, ancestors, item):
            if item.rolename:
                names[item.rolename] += 1
    Roles()(node)
    return names


def adapt_platform_acl(kind, statement, node, removed):
    """Exclude only source-platform ACL recipients, never runtime identities.

Do not create Lovable's LOGIN/BYPASSRLS roles in our independent project.
Any reference outside an ACL recipient is a new finding, not a rewrite.
"""
    references = role_names(node)
    excluded = {name: count for name, count in references.items() if name in PLATFORM_ROLES}
    if not excluded:
        return kind, statement, node
    grant = node if kind == 'GrantStmt' else node.action if kind == 'AlterDefaultPrivilegesStmt' else None
    if grant is None:
        raise GateFailed('platform_role_outside_acl_recipients')
    recipients = collections.Counter(r.rolename for r in grant.grantees if r.rolename in PLATFORM_ROLES)
    if dict(recipients) != excluded:
        raise GateFailed('platform_role_outside_acl_recipients')
    removed.update(recipients)
    grant.grantees = tuple(r for r in grant.grantees if r.rolename not in PLATFORM_ROLES)
    if not grant.grantees:
        return None
    rendered = RawStream()(node)
    parsed = parse_sql(rendered)
    if len(parsed) != 1 or type(parsed[0].stmt).__name__ != kind or any(name in PLATFORM_ROLES for name in role_names(parsed[0].stmt)):
        raise GateFailed('invalid_platform_acl_rewrite')
    return kind, rendered, parsed[0].stmt


def native_default_acl_rows(node):
    if type(node).__name__ != 'AlterDefaultPrivilegesStmt':
        return None
    options = {option.defname: option.arg for option in node.options or []}
    owners = [role.rolename for role in options.get('roles', ())]
    if 'supabase_admin' not in owners:
        return None
    schemas = [item.sval for item in options.get('schemas', ())]
    grant = node.action
    privileges = {
        'OBJECT_TABLE': ('r', ('INSERT', 'SELECT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN')),
        'OBJECT_FUNCTION': ('f', ('EXECUTE',)),
        'OBJECT_SEQUENCE': ('S', ('USAGE', 'SELECT', 'UPDATE')),
    }
    if (owners != ['supabase_admin'] or schemas != ['public']
            or set(options) != {'roles', 'schemas'} or not grant.is_grant
            or grant.grant_option or grant.privileges or grant.grantor
            or grant.objtype.name not in privileges
            or any(role.rolename not in {'postgres', 'anon', 'authenticated', 'service_role'} for role in grant.grantees)):
        raise GateFailed('unsupported_native_default_acl')
    kind, names = privileges[grant.objtype.name]
    return {('supabase_admin', 'public', kind, role.rolename, name, 'supabase_admin', False)
            for role in grant.grantees for name in names}


def verify_native_default_acl(cur, expected):
    cur.execute("""SELECT owner.rolname,n.nspname,d.defaclobjtype::text,
        CASE WHEN acl.grantee=0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl.grantee) END,
        acl.privilege_type,pg_get_userbyid(acl.grantor),acl.is_grantable
        FROM pg_default_acl d JOIN pg_roles owner ON owner.oid=d.defaclrole
        JOIN pg_namespace n ON n.oid=d.defaclnamespace
        CROSS JOIN LATERAL aclexplode(d.defaclacl) acl
        WHERE owner.rolname='supabase_admin' AND n.nspname='public'""")
    actual = {tuple(row) for row in cur.fetchall()}
    if actual != {tuple(row) for row in expected}:
        raise GateFailed('native_default_acl_drift')
    return len(actual)


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
            # Ignoring a grantor/owner switch would silently change ACL intent.
            # Our --no-owner export must not depend on session identity changes.
            if raw.stmt.name is None or raw.stmt.name.lower() in {'role', 'session_authorization'}:
                raise GateFailed('dump_session_identity_change')
            continue  # Never let dump SET/RESET override local safety settings.
        if kind == 'SelectStmt' and re.search(r"SELECT\s+pg_catalog\.set_config\('search_path',\s*'',\s*false\)", text):
            continue
        if kind not in DDL_KINDS:
            raise GateFailed('unsupported_schema_statement_' + kind)
        yield kind, text, raw.stmt


def execute_ddl(cur, expected_kind, statement):
    # Reparse the exact string passed to psycopg, independently of dump offsets.
    parsed = parse_sql(statement)
    if (expected_kind not in DDL_KINDS or len(parsed) != 1
            or type(parsed[0].stmt).__name__ != expected_kind):
        raise GateFailed('runtime_schema_statement_boundary_mismatch')
    cur.execute(statement)


def catalog(cur):
    # Metadata only. Captures existing app objects/default ACLs and managed
    # counters; callers compare before/after rollback, never persist SQL bodies.
    cur.execute("""SELECT jsonb_build_object(
      'namespaces',(SELECT coalesce(jsonb_agg(jsonb_build_array(nspname,nspowner,nspacl::text) ORDER BY nspname),'[]') FROM pg_namespace WHERE nspname IN ('public','private','referral_private','drizzle','pgmq')),
      'relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relkind,c.relowner,c.relacl::text,c.relrowsecurity,c.relforcerowsecurity,c.relreplident) ORDER BY n.nspname,c.relname),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('auth','public','private','referral_private','drizzle')),
      'routines',(SELECT coalesce(jsonb_agg(jsonb_build_array(n.nspname,p.proname,p.oid,p.proacl::text,md5(row_to_json(p)::text)) ORDER BY p.oid),'[]') FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('auth','public','private','referral_private','drizzle')),
      'auth_structure',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.oid,md5(row_to_json(a)::text),md5(coalesce(pg_get_expr(d.adbin,d.adrelid),''))) ORDER BY c.oid,a.attnum),'[]') FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname='auth' AND a.attnum>0 AND NOT a.attisdropped),
      'auth_constraints',(SELECT coalesce(jsonb_agg(jsonb_build_array(c.oid,md5(row_to_json(c)::text)) ORDER BY c.oid),'[]') FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='auth'),
      'auth_indexes',(SELECT coalesce(jsonb_agg(jsonb_build_array(i.indexrelid,md5(row_to_json(i)::text)) ORDER BY i.indexrelid),'[]') FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth'),
      'auth_policies',(SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid,md5(row_to_json(p)::text)) ORDER BY p.oid),'[]') FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth'),
      'auth_types',(SELECT coalesce(jsonb_agg(jsonb_build_array(t.oid,md5(row_to_json(t)::text)) ORDER BY t.oid),'[]') FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='auth'),
      'publications',(SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid,md5(row_to_json(p)::text)) ORDER BY p.oid),'[]') FROM pg_publication p),
      'publication_relations',(SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid,md5(row_to_json(p)::text)) ORDER BY p.oid),'[]') FROM pg_publication_rel p),
      'publication_namespaces',(SELECT coalesce(jsonb_agg(jsonb_build_array(p.oid,md5(row_to_json(p)::text)) ORDER BY p.oid),'[]') FROM pg_publication_namespace p),
      'event_triggers',(SELECT coalesce(jsonb_agg(jsonb_build_array(e.oid,md5(row_to_json(e)::text)) ORDER BY e.oid),'[]') FROM pg_event_trigger e),
      'default_acl',(SELECT coalesce(jsonb_agg(jsonb_build_array(d.defaclrole,d.defaclnamespace,d.defaclobjtype,d.defaclacl::text) ORDER BY d.oid),'[]') FROM pg_default_acl d),
      'extensions',(SELECT jsonb_agg(jsonb_build_array(extname,extversion) ORDER BY extname) FROM pg_extension),
      'auth_history',(SELECT count(*) FROM auth.schema_migrations),
      'auth_schema',(SELECT jsonb_build_array(nspowner,nspacl::text) FROM pg_namespace WHERE nspname='auth'),
      'auth_trigger_definitions',(SELECT coalesce(jsonb_agg(jsonb_build_array(t.oid,md5(row_to_json(t)::text)) ORDER BY t.oid),'[]') FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth'),
      'cron',(SELECT count(*) FROM cron.job),
      'http_queue',(SELECT count(*) FROM net.http_request_queue),
      'vault',(SELECT count(*) FROM vault.secrets),
      'storage_objects',(SELECT count(*) FROM storage.objects),
      'auth_triggers',(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='auth' AND NOT t.tgisinternal))""")
    return cur.fetchone()[0]


def target_connection(args, name):
    return psycopg.connect(**credentials(args.cli_workdir), sslmode='verify-full',
                           sslrootcert=str(args.ca), connect_timeout=15,
                           autocommit=True, application_name=name)


def verify_readback(cur, baseline):
    result = {
        'catalog_unchanged': catalog(cur) == baseline['catalog'],
        'auth_sequences_unchanged': sequence_state(cur) == baseline['auth_sequences'],
        'after_rollback_auth_rows': sum(table_count(cur, table) for table in baseline['auth_tables']),
        # Check the shared resource key across ALL sessions, including a lost
        # original connection. A lock in another backend forbids any retry.
        'advisory_lock_released': scalar(cur, "SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid=(hashtext('gorbova.copy.auth.dryrun.v1')::bigint & 4294967295)::oid") == 0,
    }
    result['rollback_verified'] = (result['catalog_unchanged']
                                   and result['auth_sequences_unchanged']
                                   and result['after_rollback_auth_rows'] == 0
                                   and result['advisory_lock_released'])
    return result


def readback_only(args, baseline):
    if (baseline.get('target') != TARGET or len(baseline.get('auth_tables', [])) != 26
            or len(set(baseline['auth_tables'])) != 26
            or any(not IDENTIFIER.fullmatch(t) for t in baseline['auth_tables'])):
        raise GateFailed('invalid_readback_baseline')
    conn = target_connection(args, 'gorbova-copy-independent-readback')
    try:
        with conn.cursor() as cur:
            cur.execute('BEGIN READ ONLY')
            cur.execute('SET LOCAL ROLE postgres')
            cur.execute("SET LOCAL statement_timeout='120s'")
            cur.execute("SET LOCAL lock_timeout='5s'")
            return verify_readback(cur, baseline)
    finally:
        try:
            conn.rollback()
        finally:
            conn.close()


def set_new_sequence(cur, before, namespace, name, value, called):
    if namespace not in APP or any(row[0] == namespace and row[1] == name for row in before['relations']):
        raise GateFailed('refusing_to_change_existing_sequence')
    if scalar(cur, 'SELECT relkind FROM pg_class WHERE oid=%s::regclass', (namespace + '.' + name,)) != 'S':
        raise GateFailed('app_sequence_missing')
    scalar(cur, 'SELECT pg_catalog.setval(%s::regclass,%s,%s)', (namespace + '.' + name, value, called))


def finish_rehearsal(conn, args, baseline, report):
    try:
        conn.rollback()
    except Exception as exc:
        report['rollback_connection_error_class'] = type(exc).__name__
    finally:
        conn.close()
    report['rollback_verified'] = False
    if baseline is not None:
        try:
            report.update(readback_only(args, baseline))
        except Exception as exc:
            report['readback_error_class'] = type(exc).__name__
    scenario = report.get('passed', False) if args.inject_failure is None else report.get('injected_failure_triggered', False)
    report['passed'] = scenario and report['rollback_verified']
    report['uncertain'] = not report['rollback_verified']


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
    adjustments = {}
    source_hashes = {}
    native_defaults = set()
    native_default_statements = 0
    for section in ('pre-data', 'post-data'):
        result = subprocess.run(dump(args, schema_list, section=section), capture_output=True)
        if result.returncode:
            raise GateFailed('schema_extract_failed')
        original = list(ddl_statements(result.stdout))
        source_hashes[section] = hashlib.sha256('\n'.join(x[1] for x in original).encode()).hexdigest()
        removed = collections.Counter()
        rewritten = [adapt_platform_acl(*item, removed) for item in original]
        phases[section] = []
        for item in rewritten:
            if item is None:
                continue
            requirement = native_default_acl_rows(item[2])
            if requirement is not None:
                native_defaults.update(requirement)
                native_default_statements += 1
            else:
                phases[section].append(item)
        adjustments[section] = dict(removed_grantees=dict(removed),
                                    omitted_platform_only_statements=sum(x is None for x in rewritten))
    phases['source_schema_statement_hashes'] = source_hashes
    phases['platform_acl_adjustments'] = adjustments
    phases['native_default_acl_rows'] = sorted(native_defaults)
    phases['native_default_acl_statements'] = native_default_statements
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
    before_path = Path(str(args.report) + '.baseline.json')
    if before_path.exists():
        raise GateFailed('baseline_already_exists_readback_required')
    conn = target_connection(args, 'gorbova-copy-full-rollback-only')
    before = sequences = None
    readback_baseline = None
    try:
        with conn.cursor() as cur:
            cur.execute('BEGIN')
            report['advisory_lock_acquired'] = preflight(cur, auth_tables)
            before, sequences = catalog(cur), sequence_state(cur)
            report['native_default_acl_rows_verified'] = verify_native_default_acl(cur, phases['native_default_acl_rows'])
            cur.execute('SELECT rolname FROM pg_roles')
            present_roles = {row[0] for row in cur.fetchall()}
            required_roles = {name for phase in ('pre-data', 'post-data') for _, _, node in phases[phase] for name in role_names(node)}
            report['missing_required_schema_roles'] = sorted(required_roles - present_roles)
            if report['missing_required_schema_roles']:
                raise GateFailed('required_schema_roles_missing')
            if scalar(cur, 'SELECT count(*) FROM pg_replication_slots'):
                raise GateFailed('target_replication_slots_present')
            if any(before[k] for k in ('cron', 'http_queue', 'vault', 'storage_objects')):
                raise GateFailed('target_not_isolated')
            if any(x[0] != 'public' for x in before['namespaces']):
                raise GateFailed('target_private_or_queue_schema_already_present')
            if not scalar(cur, 'SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user'):
                raise GateFailed('verification_role_must_bypass_rls')
            readback_baseline = dict(target=TARGET, catalog=before,
                                     auth_sequences=sequences, auth_tables=auth_tables)
            # Write metadata BEFORE any restore DDL/COPY. Survives a lost
            # process; never overwrite it or restart a rehearsal without readback.
            with before_path.open('x') as output:
                output.write(json.dumps(readback_baseline, indent=2) + '\n')
            report['readback_baseline'] = str(before_path)
            # Large COPY/hash/index commands may exceed the Auth-only 120s.
            # Each command remains bounded; disk checks happen between chunks
            # and heavy DDL, with measured largest index ~117 MiB.
            cur.execute("SET LOCAL statement_timeout='15min'")
            disk.bind_monitor(lambda: target_connection(args, 'gorbova-copy-disk-accounting'))
            cur.execute("SET LOCAL check_function_bodies=false")
            cur.execute("SET LOCAL standard_conforming_strings=on")
            report['schema_progress'] = dict(phase='pgmq-extension')
            cur.execute("CREATE EXTENSION pgmq VERSION '1.5.1'")
            for index, (kind, statement, node) in enumerate(phases['pre-data']):
                report['schema_progress'] = dict(phase='pre-data', index=index, kind=kind)
                disk.check()
                execute_ddl(cur, kind, statement)
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
                set_new_sequence(cur, before, namespace, name, value, called)
            for index, (kind, statement, node) in enumerate(phases['post-data']):
                report['schema_progress'] = dict(phase='post-data', index=index, kind=kind)
                heavy = heavy_ddl(kind, node, app['rows_by_table'])
                disk.check(force=heavy)
                execute_ddl(cur, kind, statement)
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
        try:
            finish_rehearsal(conn, args, readback_baseline, report)
        finally:
            disk.close()
        report['disk_checks'] = disk.checks
        report['disk_accounting_checks'] = disk.accounting_checks
        report['maximum_accounted_disk_fraction'] = disk.maximum_accounted_fraction
        report['maximum_disk_fraction_observed'] = disk.maximum_fraction
        report['disk_metric_freshness_waits'] = disk.freshness_waits
        report['disk_metric_freshness_wait_seconds'] = disk.freshness_wait_seconds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('cli-workdir', 'ca', 'report'):
        parser.add_argument('--' + name, type=Path, required=True)
    archive_arguments = ('archive', 'objects', 'auth-manifest', 'auth-baseline',
                         'app-baseline', 'capacity', 'pg-restore', 'temp-dir')
    for name in archive_arguments:
        parser.add_argument('--' + name, type=Path)
    parser.add_argument('--readback-from', type=Path,
                        help='Read-only verification from a saved pre-restore baseline; never restores data')
    parser.add_argument('--run-rollback-rehearsal', action='store_true')
    parser.add_argument('--inject-failure', choices=['first-app-table'])
    args = parser.parse_args()
    if args.readback_from and (args.run_rollback_rehearsal or args.inject_failure):
        parser.error('readback cannot be combined with restore or fault injection')
    if not args.readback_from and any(getattr(args, name.replace('-', '_')) is None for name in archive_arguments):
        parser.error('all archive arguments are required for plan or rehearsal')
    if args.report.exists():
        print(json.dumps({'passed': False, 'gate': 'report_already_exists', 'database_connected': False}))
        return 1
    report = dict(target=TARGET, mode='plan_only', commit_supported=False,
                  raw_sql_or_rows_persisted=False, credentials_printed=False, passed=False)
    try:
        if args.readback_from:
            report['mode'] = 'readback_only'
            report.update(readback_only(args, load_json(args.readback_from)))
            report['passed'] = report['rollback_verified']
            report['uncertain'] = not report['rollback_verified']
        else:
            prepare_or_execute(args, report)
    except Exception as exc:
        report.update(passed=False, error_class=type(exc).__name__, sqlstate=getattr(exc, 'sqlstate', None))
        if args.readback_from:
            report['uncertain'] = True
        if isinstance(exc, GateFailed):
            report['gate'] = str(exc)
    with args.report.open('x') as output:
        output.write(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))
    return 0 if report['passed'] else 1


def prepare_or_execute(args, report):
    with tempfile.TemporaryDirectory(prefix='full-rehearsal-', dir=args.temp_dir) as td:
        temp = Path(td)
        phases, auth, app, budget = plan(args, temp)
        report['source_schema_statement_hashes'] = phases['source_schema_statement_hashes']
        report['platform_acl_adjustments'] = phases['platform_acl_adjustments']
        report['native_default_acl_statements_preserved'] = phases['native_default_acl_statements']
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


if __name__ == '__main__':
    raise SystemExit(main())
