"""Safety boundaries for archive SQL and disk budget; no database/credentials."""
import datetime as dt
import unittest

from full_restore_dryrun import DiskGuard, GateFailed, ddl_statements, execute_ddl
from pglast import parse_sql
from unittest.mock import Mock


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


if __name__ == '__main__':
    unittest.main()
