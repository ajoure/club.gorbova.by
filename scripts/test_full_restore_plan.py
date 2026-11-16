"""Safety boundaries for archive SQL and disk budget; no database/credentials."""
import datetime as dt
import io
import unittest
from pathlib import Path
from types import SimpleNamespace

from full_restore_dryrun import (DiskGuard, GateFailed, ddl_statements, execute_ddl,
                                heavy_ddl, copy_load, set_new_sequence,
                                verify_readback, finish_rehearsal)
from pglast import parse_sql
from unittest.mock import Mock, MagicMock, patch


class SchemaBoundaryTests(unittest.TestCase):
    def test_runtime_rechecks_exact_slice_before_execution(self):
        cursor = Mock()
        statement = "CREATE TABLE public.probe(id int);"
        execute_ddl(cursor, 'CreateStmt', statement)
        cursor.execute.assert_called_once_with(statement)
        for kind, source in (
            ('CreateStmt', statement + ' COMMIT;'),
            ('CreateStmt', statement + statement),
            ('CreateStmt', 'CREATE VIEW public.probe AS SELECT 1;'),
            ('SelectStmt', 'SELECT 1;'),
            ('CreateStmt', ''),
        ):
            with self.subTest(kind=kind, source=source):
                cursor.reset_mock()
                with self.assertRaises(GateFailed):
                    execute_ddl(cursor, kind, source)
                cursor.execute.assert_not_called()

    def test_cyrillic_and_body_semicolons_keep_statement_boundaries(self):
        source = ("CREATE FUNCTION public.probe() RETURNS text LANGUAGE sql "
                  "AS $$SELECT 'строка; ещё';$$; CREATE TABLE public.probe_data(id int);")
        statements = list(ddl_statements(source.encode()))
        self.assertEqual([kind for kind, _, _ in statements], ['CreateFunctionStmt', 'CreateStmt'])
        for kind, text, _ in statements:
            parsed = parse_sql(text)
            self.assertEqual(len(parsed), 1)
            self.assertEqual(type(parsed[0].stmt).__name__, kind)

    def test_standalone_execution_cannot_enter_schema_plan(self):
        for source in ('BEGIN;', 'COMMIT;', 'CREATE EXTENSION dblink;',
                       'SELECT net.http_post(url := \'https://example.invalid\');',
                       "DO $$BEGIN RAISE NOTICE 'not allowed'; END$$;",
                       "COPY public.probe TO PROGRAM 'echo unsafe';"):
            with self.subTest(source=source), self.assertRaises(GateFailed):
                list(ddl_statements(source.encode()))

    def test_dump_session_settings_are_not_executed(self):
        self.assertEqual(list(ddl_statements(b"SET ROLE service_role; SET statement_timeout=0;")), [])


class DiskBoundaryTests(unittest.TestCase):
    def guard(self, used, age=0, size=1000):
        guard = DiskGuard.__new__(DiskGuard)
        guard.initial_fs = 1000
        guard.maximum_fraction = guard.last_check = 0
        guard.checks = 0
        measurement = {'timestamp': (dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=age)).isoformat(),
                       'metrics': {'fs_size_bytes': size, 'fs_used_bytes': used}}
        guard.get = lambda suffix: measurement
        return guard

    def test_threshold_stops_before_autoscale(self):
        self.guard(699).check(force=True)
        for used in (700, 900):
            with self.subTest(used=used), self.assertRaises(GateFailed):
                self.guard(used).check(force=True)

    def test_stale_metrics_and_changed_allocation_stop(self):
        for guard in (self.guard(10, age=60), self.guard(10, size=1200)):
            with self.assertRaises(GateFailed):
                guard.check(force=True)


class RestoreBoundaryTests(unittest.TestCase):
    def test_nonempty_index_and_unique_constraint_force_disk_check(self):
        for source, expected in (
            ('CREATE INDEX probe_idx ON public.probe(id);', True),
            ('ALTER TABLE public.probe ADD PRIMARY KEY(id);', True),
            ('ALTER TABLE public.probe ADD UNIQUE(id);', True),
            ('ALTER TABLE public.probe ADD CHECK(id>0);', False),
        ):
            node = parse_sql(source)[0].stmt
            kind = type(node).__name__
            with self.subTest(source=source):
                self.assertEqual(heavy_ddl(kind, node, {'public.probe': 1}), expected)
                self.assertFalse(heavy_ddl(kind, node, {'public.probe': 0}))

    def copy_case(self, payload, expected, required=None, inject=None):
        process = Mock(stdout=io.BytesIO(payload))
        process.wait.return_value = 0
        process.poll.return_value = 0
        cursor = MagicMock()
        args = SimpleNamespace(inject_failure=inject)
        with patch('full_restore_dryrun.dump', return_value=['unused']), patch('full_restore_dryrun.subprocess.Popen', return_value=process):
            copy_load(args, cursor, Path('unused'), expected, Mock(), {}, required or {})
        return cursor

    def test_copy_accepts_only_expected_table_and_complete_payload(self):
        self.copy_case(b'COPY public.probe (id) FROM stdin;\n1\n\\.\n', {'public.probe': 1})
        cases = (
            (b'COPY public.foreign_table (id) FROM stdin;\n1\n\\.\n', {}, {}),
            (b'COPY public.probe (name) FROM stdin;\n1\n\\.\n', {'public.probe': 1}, {'public.probe': {'id'}}),
            (b'COPY public.probe (id) FROM stdin;\n1\n', {'public.probe': 1}, {}),
            (b'COPY public.probe (id) FROM stdin;\n1\n\\.\n', {'public.probe': 2}, {}),
            (b'COPY public.probe (id) FROM stdin;\n1\n\\.\nCOPY public.probe (id) FROM stdin;\n1\n\\.\n', {'public.probe': 1}, {}),
        )
        for payload, expected, required in cases:
            with self.subTest(payload=payload), self.assertRaises(GateFailed):
                self.copy_case(payload, expected, required)

    def test_fault_fires_after_first_app_copy(self):
        with self.assertRaisesRegex(GateFailed, '^injected_failure$'):
            self.copy_case(b'COPY public.probe (id) FROM stdin;\n1\n\\.\n', {'public.probe': 1}, inject='first-app-table')

    def test_sequence_guard_rejects_existing_or_managed_objects(self):
        for before, namespace in (({'relations': [['public', 'probe_seq']]}, 'public'),
                                  ({'relations': []}, 'auth')):
            with patch('full_restore_dryrun.scalar') as scalar, self.assertRaises(GateFailed):
                set_new_sequence(Mock(), before, namespace, 'probe_seq', 2, True)
            scalar.assert_not_called()
        with patch('full_restore_dryrun.scalar', side_effect=['S', 2]) as scalar:
            set_new_sequence(Mock(), {'relations': []}, 'public', 'probe_seq', 2, True)
            self.assertEqual(scalar.call_count, 2)

    def test_readback_requires_catalog_sequences_rows_and_lock(self):
        baseline = {'catalog': {'stable': True}, 'auth_sequences': {'seq': [1, False]}, 'auth_tables': ['users']}
        for changed in (None, 'catalog', 'sequence', 'rows', 'lock'):
            with self.subTest(changed=changed), patch('full_restore_dryrun.catalog', return_value={} if changed == 'catalog' else baseline['catalog']), patch('full_restore_dryrun.sequence_state', return_value={} if changed == 'sequence' else baseline['auth_sequences']), patch('full_restore_dryrun.table_count', return_value=1 if changed == 'rows' else 0), patch('full_restore_dryrun.scalar', return_value=1 if changed == 'lock' else 0):
                self.assertEqual(verify_readback(Mock(), baseline)['rollback_verified'], changed is None)

    def test_lost_rollback_connection_still_uses_independent_readback(self):
        conn = Mock()
        conn.rollback.side_effect = ConnectionError('not persisted')
        report = {'passed': True}
        with patch('full_restore_dryrun.readback_only', return_value={'rollback_verified': True}) as readback:
            finish_rehearsal(conn, SimpleNamespace(inject_failure=None), {'metadata': True}, report)
            readback.assert_called_once()
        conn.close.assert_called_once()
        self.assertTrue(report['passed'])
        self.assertFalse(report['uncertain'])
        with patch('full_restore_dryrun.readback_only', side_effect=ConnectionError()):
            finish_rehearsal(Mock(), SimpleNamespace(inject_failure=None), {}, report)
        self.assertFalse(report['passed'])
        self.assertTrue(report['uncertain'])


if __name__ == '__main__':
    unittest.main()
