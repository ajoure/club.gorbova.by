"""Offline safety boundaries: no database, credentials or source access."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock

from auth_restore_dryrun import GateFailed
from cdc_probe_protocol import framed_roundtrip, lsn, transactions
from cdc_target_probe import Probe, recover


SCHEMA = 'migration_cdc_fixture'


def records(xid=1, end='0/20', change_lsn='0/10'):
    return [json.dumps(item) for item in (
        dict(action='B', xid=xid),
        dict(action='I', xid=xid, schema=SCHEMA, table='src_pk', lsn=change_lsn,
             columns=[dict(name='id', value='9007199254740993')]),
        dict(action='C', xid=xid, lsn=end, nextlsn=end))]


class ProtocolTests(unittest.TestCase):
    def test_ack_uses_commit_end_not_start(self):
        raw = records()
        raw[-1] = json.dumps(dict(action='C', xid=1, lsn='0/18', nextlsn='0/20'))
        self.assertEqual(transactions(raw, SCHEMA)[0].commit_lsn, '0/20')

    def test_partial_transaction_refused(self):
        with self.assertRaisesRegex(GateFailed, 'incomplete_transaction_no_ack'):
            transactions(records()[:-1], SCHEMA)

    def test_xid_mismatch_refused(self):
        raw = records()
        raw[-1] = json.dumps(dict(action='C', xid=2, nextlsn='0/20'))
        with self.assertRaisesRegex(GateFailed, 'invalid_transaction_commit'):
            transactions(raw, SCHEMA)

    def test_foreign_schema_and_table_refused(self):
        for key, value in (('schema', 'auth'), ('table', 'users')):
            raw = records()
            event = json.loads(raw[1])
            event[key] = value
            raw[1] = json.dumps(event)
            with self.assertRaisesRegex(GateFailed, 'foreign_change_refused'):
                transactions(raw, SCHEMA)

    def test_commit_order_not_change_order(self):
        ordered = records(end='0/20', change_lsn='0/19') + records(2, '0/30', '0/10')
        self.assertEqual(len(transactions(ordered, SCHEMA)), 2)
        with self.assertRaisesRegex(GateFailed, 'commit_order_violation'):
            transactions(records(end='0/30') + records(2, '0/20'), SCHEMA)

    def test_nested_transaction_refused(self):
        with self.assertRaisesRegex(GateFailed, 'invalid_transaction_begin'):
            transactions(records()[:1] + records(), SCHEMA)

    def test_non_object_records_refused(self):
        for raw in ('[]', 'null', '12', '"text"'):
            with self.assertRaisesRegex(GateFailed, 'invalid_decoding_record'):
                transactions([raw], SCHEMA)

    def test_unknown_action_refused(self):
        with self.assertRaisesRegex(GateFailed, 'unsupported_decoding_action'):
            transactions(['{"action":"M"}'], SCHEMA)

    def test_utf8_split_reassembled_exactly(self):
        raw = ['Ж😀' * 30000]
        restored, evidence = framed_roundtrip(raw, frame_bytes=5)
        self.assertEqual(restored, raw)
        self.assertEqual(evidence['raw_bytes'], 180000)
        self.assertEqual(evidence['frames'], 36000)

    def test_frame_bound_exceeded_refused(self):
        with self.assertRaisesRegex(GateFailed, 'fixture_transport_record_limit'):
            framed_roundtrip(['😀'], maximum_record_bytes=3)

    def test_lsn_strict(self):
        self.assertEqual(lsn('1/0'), 2**32)
        for value in ('1/-1', '1/100000000', 'z/1', None):
            with self.assertRaises(GateFailed):
                lsn(value)

    def test_replay_digest_stable_and_payload_sensitive(self):
        raw = records()
        first = transactions(raw, SCHEMA)[0]
        self.assertEqual(first.digest, transactions(raw, SCHEMA)[0].digest)
        raw[1] = raw[1].replace('9007199254740993', '9007199254740994')
        self.assertNotEqual(first.digest, transactions(raw, SCHEMA)[0].digest)

    def test_no_advance_without_exact_durable_receipt(self):
        txn = transactions(records(), SCHEMA)[0]
        for receipt in ([], [('wrong-digest',)]):
            probe = Probe.__new__(Probe)
            probe.schema, probe.stream = SCHEMA, 'owned_fixture'
            probe.sink, probe.reader = object(), object()
            probe.execute = Mock(return_value=receipt)
            with self.assertRaisesRegex(GateFailed, 'ack_without_durable_commit'):
                probe.advance(txn)
            self.assertEqual(probe.execute.call_count, 1)
            self.assertIs(probe.execute.call_args.args[0], probe.sink)

    def test_unknown_column_cannot_be_sql(self):
        probe = Probe.__new__(Probe)
        with self.assertRaisesRegex(GateFailed, 'unknown_fixture_column'):
            probe.value('id); DROP SCHEMA auth CASCADE;--', 1)
        with self.assertRaisesRegex(GateFailed, 'unsupported_bytea_encoding'):
            probe.value('raw', '\\xDEAD')

    def test_recovery_rejects_foreign_target_before_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'manifest.json'
            path.write_text(json.dumps(dict(target='foreign')))
            args = Mock(manifest=path)
            with self.assertRaisesRegex(GateFailed, 'invalid_owned_recovery_manifest'):
                recover(args, {})

    def test_plan_only_does_not_need_credentials_or_create_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            command = [sys.executable, str(Path(__file__).with_name('cdc_target_probe.py'))]
            for name in ('cli-workdir', 'ca', 'auth-manifest', 'manifest', 'report'):
                command += ['--' + name, str(root / name)]
            result = subprocess.run(command, capture_output=True, text=True, check=True)
            report = json.loads(result.stdout)
            self.assertEqual(report['mode'], 'plan_only')
            self.assertFalse(report['database_connected'])
            self.assertEqual(list(root.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
