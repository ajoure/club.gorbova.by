#!/usr/bin/env python3
"""Plan/run an owned, synthetic SQL CDC fixture on the pinned empty target.

Unlike the restore rehearsal this commits SYNTHETIC private fixtures, then
removes only owned resources. Never targets source, Auth, Storage or public.
Default is plan-only. Production CDC and snapshot overlap are NOT proved here.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time
import uuid

import psycopg
from psycopg import sql

from auth_restore_dryrun import TARGET, GateFailed, credentials, scalar, sequence_state, fingerprint
from full_restore_dryrun import catalog, readback_only
from cdc_probe_protocol import framed_roundtrip, transactions, lsn

TESTS = tuple('T' + str(i) for i in range(1, 16))
TYPES = {'id': 'bigint', 'n': 'numeric', 'ts': 'timestamptz', 'raw': 'bytea',
         'doc': 'json', 'jb': 'jsonb', 'body': 'text', 'flag': 'text', 's': 'text'}


def write_json(path, value, exclusive=False):
    flags = os.O_WRONLY | os.O_CREAT | (os.O_EXCL if exclusive else os.O_TRUNC)
    with os.fdopen(os.open(path, flags, 0o600), 'w') as stream:
        stream.write(json.dumps(value, indent=2) + '\n')
        stream.flush()
        os.fsync(stream.fileno())


class Probe:
    def __init__(self, args, report):
        self.args, self.report = args, report
        self.nonce = uuid.uuid4().hex[:16]
        self.schema, self.stream = 'migration_cdc_' + self.nonce, 'gorbova_cdc_' + self.nonce
        self.started = time.monotonic()
        self.manifest = dict(target=TARGET, nonce=self.nonce, schema=self.schema,
                             stream=self.stream, schema_created=False, stream_created=False,
                             creation_intent=True, synthetic_only=True)
        write_json(args.manifest, self.manifest, exclusive=True)
        self.connections = []
        self.control = self.reader = self.writer = self.sink = None
        self.before = None
        self.params = credentials(args.cli_workdir)  # Password stays in memory.
        self.created_lsn = None

    def connect(self):
        conn = psycopg.connect(**self.params, sslmode='verify-full', sslrootcert=str(self.args.ca),
                               connect_timeout=15, autocommit=True,
                               application_name='gorbova-owned-cdc-fixture')
        self.connections.append(conn)
        with conn.cursor() as cur:
            cur.execute('SET ROLE postgres')
            cur.execute("SET timezone='UTC'")
            cur.execute("SET datestyle='ISO, MDY'")
            cur.execute("SET intervalstyle='postgres'")
            cur.execute("SET bytea_output='hex'")
            cur.execute('SET extra_float_digits=3')
            cur.execute("SET statement_timeout='15s'")
            cur.execute("SET lock_timeout='5s'")
            if not scalar(cur, 'SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()'):
                raise GateFailed('backend_tls_required')
        return conn

    def save_manifest(self):
        temporary = self.args.manifest.with_name(self.args.manifest.name + '.pending')
        write_json(temporary, self.manifest)
        os.replace(temporary, self.args.manifest)

    def execute(self, conn, text, params=None):
        self.guard()
        with conn.cursor() as cur:
            cur.execute(text, params)
            return cur.fetchall() if cur.description else []

    def guard(self):
        if time.monotonic() - self.started > 300:
            raise GateFailed('fixture_ttl_exceeded')
        if self.control and self.created_lsn:
            with self.control.cursor() as cur:
                cur.execute("SELECT wal_status,pg_wal_lsn_diff(pg_current_wal_insert_lsn(),restart_lsn),confirmed_flush_lsn::text,catalog_xmin::text FROM pg_replication_slots WHERE slot_name=%s", (self.stream,))
                row = cur.fetchone()
                if not row or row[0] not in {'reserved', 'extended'} or row[1] is None or row[1] > 64 * 1024 * 1024:
                    raise GateFailed('fixture_wal_budget_or_stream_state')
                self.report['last_stream_state'] = dict(wal_status=row[0], retained_bytes=int(row[1]),
                                                        confirmed_flush_lsn=row[2], catalog_xmin=row[3])

    def table(self, name):
        if name not in {'src_pk', 'src_bag', 'dst_pk', 'dst_bag', 'applied'}:
            raise GateFailed('foreign_fixture_table')
        return sql.SQL('{}.{}').format(sql.Identifier(self.schema), sql.Identifier(name))

    def setup(self):
        self.control = self.connect()
        with self.control.cursor() as cur:
            if not scalar(cur, "SELECT pg_try_advisory_lock(hashtext('gorbova.copy.auth.dryrun.v1'))"):
                raise GateFailed('target_resource_busy')
            if scalar(cur, "SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'migration_cdc_%'") or scalar(cur, 'SELECT count(*) FROM pg_replication_slots'):
                raise GateFailed('existing_probe_or_stream_requires_readback')
            if scalar(cur, "SELECT current_setting('server_version_num')::int/10000") != 17:
                raise GateFailed('target_postgres17_required')
            data = json.loads(self.args.auth_manifest.read_text())
            names = [item['table'] for item in data['data_order']]
            if data['target'] != TARGET or len(names) != 26 or len(set(names)) != 26:
                raise GateFailed('invalid_auth_manifest')
            if any(scalar(cur, sql.SQL('SELECT count(*) FROM auth.{}').format(sql.Identifier(name))) for name in names):
                raise GateFailed('target_auth_not_empty')
            self.before = dict(target=TARGET, catalog=catalog(cur), auth_sequences=sequence_state(cur), auth_tables=names)
            if self.before['catalog']['relations'] and any(row[0] in {'public', 'private', 'referral_private', 'drizzle'} and row[2] in {'r', 'p'} for row in self.before['catalog']['relations']):
                raise GateFailed('target_app_not_empty')
            if any(self.before['catalog'][key] for key in ('cron', 'http_queue', 'vault', 'storage_objects')):
                raise GateFailed('target_not_isolated')
        self.manifest['before'] = self.before
        self.save_manifest()
        self.writer, self.reader, self.sink = self.connect(), self.connect(), self.connect()
        with self.writer.cursor() as cur:
            cur.execute('BEGIN')
            try:
                cur.execute(sql.SQL('CREATE SCHEMA {}').format(sql.Identifier(self.schema)))
                cur.execute(sql.SQL('COMMENT ON SCHEMA {} IS {}').format(sql.Identifier(self.schema), sql.Literal('gorbova-cdc-probe:' + self.nonce)))
                cur.execute(sql.SQL('REVOKE ALL ON SCHEMA {} FROM PUBLIC,anon,authenticated,service_role').format(sql.Identifier(self.schema)))
                for name in ('src_pk', 'dst_pk'):
                    cur.execute(sql.SQL('CREATE TABLE {} (id bigint PRIMARY KEY,n numeric,ts timestamptz,raw bytea,doc json,jb jsonb,body text,flag text)').format(self.table(name)))
                for name in ('src_bag', 'dst_bag'):
                    cur.execute(sql.SQL('CREATE TABLE {} (s text,n numeric)').format(self.table(name)))
                cur.execute(sql.SQL('CREATE TABLE {} (stream text,xid text,commit_lsn pg_lsn,digest text,PRIMARY KEY(stream,xid,commit_lsn))').format(self.table('applied')))
                cur.execute('COMMIT')
            except BaseException:
                self.writer.rollback()
                raise
        self.manifest['schema_created'] = True
        self.save_manifest()
        # Isolated autocommit call on reader: no prior writes in this transaction.
        self.manifest['stream_creation_intent'] = True
        self.save_manifest()
        with self.reader.cursor() as cur:
            cur.execute("SELECT slot_name,lsn::text FROM pg_create_logical_replication_slot(%s,'wal2json',false,false,false)", (self.stream,))
            name, self.created_lsn = cur.fetchone()
            if name != self.stream:
                raise GateFailed('stream_creation_name_mismatch')
        self.manifest.update(stream_created=True, created_lsn=self.created_lsn)
        self.save_manifest()
        self.report.update(resources=dict(schema=self.schema, stream=self.stream), tests={})

    def peek(self, limit=None):
        options = ['format-version', '2', 'include-xids', '1', 'include-lsn', '1',
                   'include-transaction', '1', 'include-empty-transaction', '0',
                   'numeric-data-types-as-string', '1', 'actions', 'insert,update,delete,truncate',
                   'add-tables', self.schema + '.src_pk,' + self.schema + '.src_bag',
                   'add-msg-prefixes', 'gorbova_cdc_fixture_no_messages']
        rows = self.execute(self.reader, 'SELECT data FROM pg_logical_slot_peek_changes(%s,NULL,%s,VARIADIC %s::text[])', (self.stream, limit, options))
        raw = [row[0] for row in rows]
        restored, evidence = framed_roundtrip(raw)
        self.report['last_transport'] = evidence
        return transactions(restored, self.schema)

    def value(self, column, value):
        if column not in TYPES:
            raise GateFailed('unknown_fixture_column')
        if column == 'raw':
            if value is not None and (not isinstance(value, str) or any(c not in '0123456789abcdefABCDEF' for c in value)):
                raise GateFailed('unsupported_bytea_encoding')
            return sql.SQL("decode(%s,'hex')"), value
        return sql.SQL('CAST(%s AS {})').format(sql.SQL(TYPES[column])), value

    def apply(self, txn):
        self.guard()
        with self.sink.cursor() as cur:
            cur.execute('BEGIN')
            try:
                cur.execute(sql.SQL('INSERT INTO {} VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING 1').format(self.table('applied')), (self.stream, txn.xid, txn.commit_lsn, txn.digest))
                if not cur.fetchone():
                    cur.execute(sql.SQL('SELECT digest FROM {} WHERE stream=%s AND xid=%s AND commit_lsn=%s').format(self.table('applied')), (self.stream, txn.xid, txn.commit_lsn))
                    if cur.fetchone()[0] != txn.digest:
                        raise GateFailed('duplicate_transaction_digest_changed')
                    self.sink.rollback()
                    return False
                for event in txn.events:
                    destination = self.table('dst_pk' if event['table'] == 'src_pk' else 'dst_bag')
                    action = event['action']
                    if action == 'T':
                        cur.execute(sql.SQL('TRUNCATE {}').format(destination))
                        continue
                    columns = event.get('columns', [])
                    names = [item['name'] for item in columns]
                    if len(names) != len(set(names)):
                        raise GateFailed('duplicate_fixture_column')
                    values = [self.value(item['name'], item.get('value')) for item in columns]
                    if action == 'I':
                        cur.execute(sql.SQL('INSERT INTO {} ({}) VALUES ({})').format(destination, sql.SQL(',').join(map(sql.Identifier, names)), sql.SQL(',').join(item[0] for item in values)), [item[1] for item in values])
                        continue
                    identity = event.get('identity')
                    if event['table'] == 'src_pk':
                        identity = [item for item in identity or columns if item['name'] == 'id']
                    if not identity:
                        raise GateFailed('no_replica_identity')
                    conditions, keys = [], []
                    for item in identity:
                        expression, value = self.value(item['name'], item.get('value'))
                        conditions.append(sql.SQL('{} IS NOT DISTINCT FROM {}').format(sql.Identifier(item['name']), expression))
                        keys.append(value)
                    where = sql.SQL('ctid=(SELECT ctid FROM {} WHERE {} LIMIT 1)').format(destination, sql.SQL(' AND ').join(conditions))
                    if action == 'D':
                        cur.execute(sql.SQL('DELETE FROM {} WHERE {}').format(destination, where), keys)
                    else:
                        setters = sql.SQL(',').join(sql.SQL('{}={}').format(sql.Identifier(name), expression) for name, (expression, _) in zip(names, values))
                        cur.execute(sql.SQL('UPDATE {} SET {} WHERE {}').format(destination, setters, where), [value for _, value in values] + keys)
                    if cur.rowcount != 1:
                        raise GateFailed('fixture_identity_match_not_one')
                cur.execute('COMMIT')
                return True
            except BaseException:
                self.sink.rollback()
                raise

    def advance(self, txn):
        # Durable receipt must exist before touching producer acknowledgement.
        rows = self.execute(self.sink, sql.SQL('SELECT digest FROM {} WHERE stream=%s AND xid=%s AND commit_lsn=%s').format(self.table('applied')), (self.stream, txn.xid, txn.commit_lsn))
        if rows != [(txn.digest,)]:
            raise GateFailed('ack_without_durable_commit')
        advanced = self.execute(self.reader, 'SELECT end_lsn::text FROM pg_replication_slot_advance(%s,%s::pg_lsn)', (self.stream, txn.commit_lsn))
        if advanced != [(txn.commit_lsn,)]:
            raise GateFailed('ack_position_requires_readback')

    def drain(self, limit=None):
        found = self.peek(limit)
        for txn in found:
            self.apply(txn)
            self.advance(txn)
        return found

    def rows_hash(self, name):
        # Hash server COPY text, not Python-converted values or unordered rows.
        self.guard()
        with self.control.cursor() as cur:
            with cur.copy(sql.SQL('COPY {} TO STDOUT').format(self.table(name))) as copy:
                return fingerprint(copy)

    def equal(self):
        return self.rows_hash('src_pk') == self.rows_hash('dst_pk') and self.rows_hash('src_bag') == self.rows_hash('dst_bag')

    def check(self, name, passed):
        self.guard()
        self.report['tests'][name] = bool(passed)
        if not passed:
            raise GateFailed('fixture_test_failed_' + name)

    def insert_pk(self, identifier, body='fixture', **values):
        params = (identifier, values.get('n', '100.00'), values.get('ts', '2026-01-02 03:04:05.123456-03:30'),
                  values.get('raw', b'\x00\xff\n'), values.get('doc', '{"fixture":1}'),
                  values.get('jb', '{"unicode":"Ж😀"}'), body, 'initial')
        self.execute(self.writer, sql.SQL('INSERT INTO {} VALUES(%s,%s::numeric,%s::timestamptz,%s,%s::json,%s::jsonb,%s,%s)').format(self.table('src_pk')), params)

    def tests(self):
        self.insert_pk(1)
        self.drain()
        self.execute(self.writer, sql.SQL("UPDATE {} SET flag='updated' WHERE id=1").format(self.table('src_pk')))
        self.drain()
        self.execute(self.writer, sql.SQL('DELETE FROM {} WHERE id=1').format(self.table('src_pk')))
        self.drain()
        self.check('T1', self.equal())
        self.insert_pk(2)
        self.drain()
        self.execute(self.writer, sql.SQL('UPDATE {} SET id=3 WHERE id=2').format(self.table('src_pk')))
        self.drain()
        self.check('T2', self.equal())
        self.execute(self.writer, sql.SQL('TRUNCATE {}').format(self.table('src_pk')))
        truncated = self.drain()
        self.check('T3', any(event['action'] == 'T' for txn in truncated for event in txn.events) and self.equal())
        self.execute(self.writer, 'BEGIN')
        self.insert_pk(4)
        self.writer.rollback()
        self.check('T4', not self.drain() and self.equal())
        self.execute(self.writer, 'BEGIN')
        self.insert_pk(501)
        short = self.connect()
        self.execute(short, sql.SQL('INSERT INTO {} (id,body) VALUES(502,%s)').format(self.table('src_pk')), ('short',))
        first = self.drain()
        self.writer.commit()
        second = self.drain()
        self.check('T5', bool(first and second) and lsn(first[-1].commit_lsn) < lsn(second[0].commit_lsn) and self.equal())
        self.execute(self.writer, sql.SQL('INSERT INTO {} VALUES(NULL,10.00),(NULL,10.00)').format(self.table('src_bag')))
        self.drain()
        self.execute(self.writer, sql.SQL("UPDATE {} SET s='' WHERE ctid=(SELECT ctid FROM {} LIMIT 1)").format(self.table('src_bag'), self.table('src_bag')))
        omitted = self.peek()
        self.check('T6_default_gap', not self.equal() and not any(e['action'] == 'U' and e['table'] == 'src_bag' for t in omitted for e in t.events))
        # Explicit fixture rebaseline after the EXPECTED identity gap. This is
        # never presented as production recovery or overlap correctness.
        self.execute(self.writer, sql.SQL('ALTER TABLE {} REPLICA IDENTITY FULL').format(self.table('src_bag')))
        self.execute(self.sink, sql.SQL('TRUNCATE {}').format(self.table('dst_bag')))
        self.execute(self.sink, sql.SQL('INSERT INTO {} SELECT * FROM {}').format(self.table('dst_bag'), self.table('src_bag')))
        self.report['explicit_fixture_rebaselines'] = 1
        self.execute(self.writer, sql.SQL('TRUNCATE {}').format(self.table('src_bag')))
        self.drain()
        self.execute(self.writer, sql.SQL("INSERT INTO {} VALUES('same',NULL),('same',NULL)").format(self.table('src_bag')))
        self.drain()
        self.execute(self.writer, sql.SQL('DELETE FROM {} WHERE ctid=(SELECT ctid FROM {} LIMIT 1)').format(self.table('src_bag'), self.table('src_bag')))
        self.drain()
        self.check('T6', self.equal() and self.rows_hash('src_bag')[0] == 1)
        self.execute(self.writer, sql.SQL('TRUNCATE {}').format(self.table('src_bag')))
        self.execute(self.writer, sql.SQL("INSERT INTO {} VALUES('overlap',NULL),('overlap',NULL),('overlap',NULL)").format(self.table('src_bag')))
        self.drain()
        self.execute(self.writer, sql.SQL('DELETE FROM {} WHERE ctid=(SELECT ctid FROM {} LIMIT 1)').format(self.table('src_bag'), self.table('src_bag')))
        overlap = self.peek()
        # Newer baseline already contains the DELETE. Replaying that DELETE
        # against identical keyless duplicates demonstrates the known gap.
        self.execute(self.sink, sql.SQL('TRUNCATE {}').format(self.table('dst_bag')))
        self.execute(self.sink, sql.SQL('INSERT INTO {} SELECT * FROM {}').format(self.table('dst_bag'), self.table('src_bag')))
        for txn in overlap:
            self.apply(txn)
            self.advance(txn)
        self.check('T6_overlap_gap', self.rows_hash('src_bag')[0] == 2 and self.rows_hash('dst_bag')[0] == 1)
        self.execute(self.sink, sql.SQL('TRUNCATE {}').format(self.table('dst_bag')))
        self.execute(self.sink, sql.SQL('INSERT INTO {} SELECT * FROM {}').format(self.table('dst_bag'), self.table('src_bag')))
        self.report['explicit_fixture_rebaselines'] += 2
        big = ''.join(hashlib.sha256(str(i).encode()).hexdigest() for i in range(16384))
        self.insert_pk(701, body=big)
        self.drain()
        for identity in ('DEFAULT', 'FULL'):
            self.execute(self.writer, sql.SQL('ALTER TABLE {} REPLICA IDENTITY {}').format(self.table('src_pk'), sql.SQL(identity)))
            self.execute(self.writer, sql.SQL('UPDATE {} SET flag=%s WHERE id=701').format(self.table('src_pk')), (identity,))
            changes = self.drain()
            toast_omitted = any(e['action'] == 'U' and not any(c['name'] == 'body' for c in e.get('columns', [])) for t in changes for e in t.events)
            self.check('T7_' + identity.lower(), toast_omitted and self.equal())
        self.check('T7', True)
        self.insert_pk(9007199254740993, body='Unicode Ж😀', n='123456789012345678901234567890.123456789', doc=r'{"zero":"\u0000"}')
        self.insert_pk(801, n='NaN')
        self.drain()
        self.check('T8', self.equal())
        for identifier, label, invalid in ((802, 'nul', r'{"zero":"\u0000"}'), (803, 'surrogate', r'{"bad":"\ud800"}')):
            try:
                self.insert_pk(identifier, jb=invalid)
            except psycopg.DataError as exc:
                if exc.sqlstate not in {'22P05', '22021', '22P02'}:
                    raise
                self.writer.rollback()
                self.report['jsonb_' + label + '_correctly_rejected'] = True
            else:
                raise GateFailed('invalid_jsonb_unexpectedly_accepted')
        self.execute(self.writer, 'BEGIN')
        for i in range(40):
            self.insert_pk(10000 + i, body=big[i:i + 32768])
        self.writer.commit()
        pending = self.peek(limit=1)
        self.check('T9', len(pending) == 1 and len(pending[0].events) == 40)
        try:
            self.advance(pending[0])
        except GateFailed as exc:
            self.check('T9_no_partial_ack', str(exc) == 'ack_without_durable_commit')
        else:
            raise GateFailed('partial_ack_unexpectedly_allowed')
        self.check('T10', self.report['last_transport']['raw_bytes'] > 786432 and self.report['last_transport']['frames'] > 40)
        for txn in pending:
            self.apply(txn)  # Simulated lost ACK response: do not advance yet.
        replayed = self.peek(limit=1)
        self.check('T11', [t.digest for t in replayed] == [t.digest for t in pending] and all(not self.apply(t) for t in replayed) and self.equal())
        for txn in replayed:
            self.advance(txn)
        self.check('T12', not self.peek())
        self.reader.close()
        self.insert_pk(1301)
        self.reader = self.connect()
        self.drain()
        self.check('T13', self.equal())
        with self.control.cursor() as cur:
            cur.execute("""SELECT
              (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=%s),
              (SELECT count(*) FROM pg_publication_tables WHERE schemaname=%s),
              (SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND has_schema_privilege(oid,%s,'USAGE'))""", (self.schema, self.schema, self.schema))
            isolated = cur.fetchone() == (0, 0, 0)
            self.check('T14', isolated and catalog(cur) == self.before['catalog'] and sequence_state(cur) == self.before['auth_sequences'])
        self.report['known_production_gaps'] = ['DEFAULT identity loses keyless updates', 'overlapping baseline with keyless duplicates is not idempotent', 'source API large-transaction and snapshot contract unproven', 'Storage bytes/Auth signing/fencing not tested']

    def cleanup(self):
        # No TTL checks here: safety cleanup must run even after a test timeout.
        errors = []
        for conn in self.connections:
            if not conn.closed:
                try:
                    conn.rollback()
                except Exception:
                    pass
        if self.control and not self.control.closed:
            with self.control.cursor() as cur:
                cur.execute('SELECT plugin,database,active FROM pg_replication_slots WHERE slot_name=%s', (self.stream,))
                row = cur.fetchone()
                if row:
                    if not self.manifest['stream_created'] or row != ('wal2json', 'postgres', False):
                        errors.append('unverified_stream_ownership')
                    else:
                        cur.execute('SELECT pg_drop_replication_slot(%s)', (self.stream,))
                cur.execute('SELECT obj_description(n.oid,\'pg_namespace\'),pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname=%s', (self.schema,))
                row = cur.fetchone()
                if row and not errors:
                    if not self.manifest['schema_created'] or row != ('gorbova-cdc-probe:' + self.nonce, 'postgres'):
                        errors.append('unverified_schema_ownership')
                    else:
                        cur.execute(sql.SQL('DROP SCHEMA {} CASCADE').format(sql.Identifier(self.schema)))
                cur.execute('SELECT (SELECT count(*) FROM pg_namespace WHERE nspname=%s),(SELECT count(*) FROM pg_replication_slots WHERE slot_name=%s)', (self.schema, self.stream))
                self.report['owned_resources_absent'] = cur.fetchone() == (0, 0)
        for conn in self.connections:
            conn.close()
        if self.before is not None:
            self.report['independent_readback'] = readback_only(self.args, self.before)
        self.report['cleanup_errors'] = errors
        self.report.setdefault('tests', {})['T15'] = not errors and self.report.get('owned_resources_absent', False) and self.report.get('independent_readback', {}).get('rollback_verified', False)
        self.manifest['cleanup_verified'] = self.report['tests']['T15']
        self.save_manifest()


def recover(args, report):
    manifest = json.loads(args.manifest.read_text())
    nonce = manifest.get('nonce', '')
    if (manifest.get('target') != TARGET or not re.fullmatch(r'[0-9a-f]{16}', nonce)
            or manifest.get('schema') != 'migration_cdc_' + nonce
            or manifest.get('stream') != 'gorbova_cdc_' + nonce
            or not manifest.get('before')):
        raise GateFailed('invalid_owned_recovery_manifest')
    probe = Probe.__new__(Probe)
    probe.args, probe.report, probe.manifest = args, report, manifest
    probe.nonce, probe.schema, probe.stream = nonce, manifest['schema'], manifest['stream']
    probe.started, probe.connections = time.monotonic(), []
    probe.before, probe.created_lsn = manifest['before'], manifest.get('created_lsn')
    probe.params = credentials(args.cli_workdir)
    probe.control = probe.reader = probe.writer = probe.sink = None
    try:
        probe.control = probe.connect()
        with probe.control.cursor() as cur:
            if not scalar(cur, "SELECT pg_try_advisory_lock(hashtext('gorbova.copy.auth.dryrun.v1'))"):
                raise GateFailed('target_resource_busy')
        probe.cleanup()
    finally:
        for conn in probe.connections:
            conn.close()
    report['passed'] = report.get('tests', {}).get('T15', False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('cli-workdir', 'ca', 'auth-manifest', 'manifest', 'report'):
        parser.add_argument('--' + name, type=Path, required=True)
    parser.add_argument('--run-target-fixture', action='store_true')
    parser.add_argument('--recover-owned-fixture', action='store_true')
    args = parser.parse_args()
    if args.run_target_fixture and args.recover_owned_fixture:
        parser.error('cannot combine run and recovery')
    if args.report.exists() or (args.manifest.exists() and not args.recover_owned_fixture):
        print(json.dumps(dict(passed=False, gate='existing_evidence_requires_readback')))
        return 1
    report = dict(target=TARGET, synthetic_only=True, production_ready=False, source_access_supported=False,
                  source_touched=False, database_connected=False, passed=False)
    if args.recover_owned_fixture:
        try:
            recover(args, report)
        except Exception as exc:
            report.update(passed=False, error_class=type(exc).__name__)
            if isinstance(exc, GateFailed):
                report['gate'] = str(exc)
        report['uncertain'] = not report.get('passed', False)
        write_json(args.report, report, exclusive=True)
        print(json.dumps(report))
        return 0 if report['passed'] else 1
    if not args.run_target_fixture:
        report.update(mode='plan_only', tests_planned=list(TESTS), maximum_seconds=300, maximum_retained_wal_bytes=67108864)
        print(json.dumps(report))
        return 0
    probe = None
    try:
        probe = Probe(args, report)
        report.update(database_connected=True, mode='owned_target_fixture')
        probe.setup()
        probe.tests()
    except Exception as exc:
        report.update(error_class=type(exc).__name__, sqlstate=getattr(exc, 'sqlstate', None))
        if isinstance(exc, GateFailed):
            report['gate'] = str(exc)
    finally:
        if probe is not None:
            try:
                probe.cleanup()
            except Exception as exc:
                report['cleanup_error_class'] = type(exc).__name__
            finally:
                for conn in probe.connections:
                    conn.close()
    report['passed'] = all(report.get('tests', {}).get(name, False) for name in TESTS) and 'error_class' not in report
    report['uncertain'] = not report.get('tests', {}).get('T15', False)
    write_json(args.report, report, exclusive=True)
    print(json.dumps(report))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
