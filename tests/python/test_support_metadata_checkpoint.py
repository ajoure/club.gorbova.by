import importlib.util
import json
import multiprocessing
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[2] / 'scripts' / 'support_metadata_checkpoint.py'
spec = importlib.util.spec_from_file_location('checkpoint', SCRIPT)
cp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cp)


def envelope(values):
    return {'complete': True, 'pagination_complete': True,
            'rows': [{'metadata_key': key, 'metadata': value} for key, value in values.items()]}


def ingest_process(path, value):
    cp.ingest(path, envelope({'ticket:synthetic': {'latest_incoming_id': value}}))


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'checkpoint.json'
        self.base = {'ticket:synthetic': {'latest_incoming_id': 'message-a', 'read': False, 'requires_reply': True,
                                          'technical_promise': 'investigate paid recording'}}
        cp.initialize(self.path, envelope(self.base), 'verified-baseline')

    def state(self):
        return cp.load_json(self.path)[cp.NAMESPACE]

    def change(self, **fields):
        value = dict(self.base['ticket:synthetic'], **fields)
        return cp.ingest(self.path, envelope({'ticket:synthetic': value}))

    def test_crash_after_ingest_before_handoff_survives_next_noop_and_restart(self):
        first = self.change(latest_incoming_id='message-b')
        # A separate process reopens the persisted checkpoint, no in-memory state.
        snap = Path(self.temp.name) / 'snapshot.json'
        snap.write_text(json.dumps(envelope({'ticket:synthetic': dict(self.base['ticket:synthetic'], latest_incoming_id='message-b')})))
        completed = subprocess.run([sys.executable, str(SCRIPT), '--checkpoint', str(self.path),
                                    'ingest', '--snapshot', str(snap)], capture_output=True, text=True, check=True)
        second = json.loads(completed.stdout)
        self.assertEqual(second['operation'], 'noop')
        self.assertEqual(second['pending'], first['pending'])
        self.assertEqual(len(self.state()['outbox']), 1)

    def test_uncertain_never_retries_and_blocks_newer_revision_same_key(self):
        event = self.change(latest_incoming_id='message-b')['pending'][0]['event_id']
        cp.record(self.path, event, 'pending', 'dispatching', 'handoff-ledger:synthetic')
        cp.record(self.path, event, 'dispatching', 'uncertain', 'handoff-ledger:synthetic')
        result = self.change(latest_incoming_id='message-c')
        self.assertEqual(result['pending'], [])
        self.assertEqual(len(result['blocked_pending']), 1)
        self.assertEqual(result['in_flight'][0]['status'], 'uncertain')
        with self.assertRaises(cp.CheckpointError):
            cp.record(self.path, event, 'uncertain', 'pending', 'handoff-ledger:synthetic')
        other = result['blocked_pending'][0]['event_id']
        with self.assertRaises(cp.CheckpointError):
            cp.record(self.path, other, 'pending', 'dispatching', 'handoff-ledger:other')

    def test_accepted_verified_are_not_pending(self):
        event = self.change(latest_incoming_id='message-b')['pending'][0]['event_id']
        for before, after in [('pending', 'dispatching'), ('dispatching', 'api_accepted'), ('api_accepted', 'verified')]:
            result = cp.record(self.path, event, before, after, 'ledger:one')
            self.assertEqual(result['pending'], [])
        before = self.path.read_bytes()
        self.assertEqual(cp.record(self.path, event, 'pending', 'verified', 'ledger:one')['operation'], 'already_recorded')
        self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaises(cp.CheckpointError):
            cp.record(self.path, event, 'verified', 'dispatching', 'ledger:two')

    def test_partial_errors_and_invalid_rows_do_not_advance(self):
        for mutate in [lambda e: e.update(complete=False), lambda e: e.update(pagination_complete=False),
                       lambda e: e.update(error='unavailable'), lambda e: e.update(errors=['partial']),
                       lambda e: e.update(success=False), lambda e: e.update(status='error'),
                       lambda e: e.update(next_cursor='more-pages'),
                       lambda e: e.update(rows=[{'metadata_key': 'ticket:synthetic', 'metadata': None}])]:
            with self.subTest(mutate=mutate):
                e = envelope({}); mutate(e); before = self.path.read_bytes()
                with self.assertRaises(cp.CheckpointError):
                    cp.ingest(self.path, e)
                self.assertEqual(self.path.read_bytes(), before)

    def test_duplicate_metadata_keys_fail_without_write(self):
        e = envelope(self.base); e['rows'] *= 2; before = self.path.read_bytes()
        with self.assertRaises(cp.CheckpointError):
            cp.ingest(self.path, e)
        self.assertEqual(self.path.read_bytes(), before)

    def test_duplicate_json_keys_and_nonfinite_fail(self):
        file = Path(self.temp.name) / 'bad.json'
        for value in ['{"complete":true,"complete":false}', '{"x":NaN}']:
            file.write_text(value)
            with self.assertRaises(cp.CheckpointError):
                cp.load_json(file)

    def test_replace_failure_keeps_exact_old_bytes_and_no_temp_file(self):
        before = self.path.read_bytes()
        with patch.object(cp.os, 'replace', side_effect=OSError('synthetic failure')):
            with self.assertRaises(OSError):
                self.change(latest_incoming_id='message-b')
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.path.parent.iterdir()), ['checkpoint.json', 'checkpoint.json.lock'])

    def test_pre_replace_fsync_failure_keeps_exact_old_bytes(self):
        before = self.path.read_bytes()
        with patch.object(cp.os, 'fsync', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(OSError):
                self.change(latest_incoming_id='message-b')
        self.assertEqual(self.path.read_bytes(), before)

    def test_post_replace_fsync_failure_can_be_reconciled_without_duplicate(self):
        original = cp.os.fsync
        count = 0
        def fsync(fd):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError('directory sync unknown')
            original(fd)
        with patch.object(cp.os, 'fsync', side_effect=fsync):
            with self.assertRaises(OSError):
                self.change(latest_incoming_id='message-b')
        result = self.change(latest_incoming_id='message-b')
        self.assertEqual(result['operation'], 'noop')
        self.assertEqual(len(result['pending']), 1)

    def test_explicit_bootstrap_preserves_legacy_unknown_fields_and_not_nochange(self):
        other = Path(self.temp.name) / 'legacy.json'
        legacy = {'signatures': {'old': 'legacy-format'}, 'pending': [{'status': 'uncertain'}],
                  'custom': {'cursor': 7}, 'uncertain': ['external-ledger:held']}
        other.write_text(json.dumps(legacy))
        before = other.read_bytes()
        with self.assertRaises(cp.CheckpointError):
            cp.ingest(other, envelope(self.base))
        self.assertEqual(other.read_bytes(), before)
        result = cp.initialize(other, envelope(self.base), 'independently-checked-full-baseline')
        for key, value in legacy.items():
            self.assertEqual(cp.load_json(other)[key], value)
        self.assertEqual(result['operation'], 'initialized')
        self.assertTrue(result['not_a_no_changes_check'])
        self.assertEqual(result['pending'], [])
        self.assertTrue(result['legacy_outbox_present'])
        with self.assertRaises(cp.CheckpointError):
            cp.initialize(other, envelope({}), 'ref')

    def test_import_legacy_into_new_checkpoint(self):
        other = Path(self.temp.name) / 'new.json'
        legacy = {'foreign': [1, 2], 'pending': ['do-not-delete']}
        cp.initialize(other, envelope({}), 'verified-empty', legacy)
        self.assertEqual(cp.load_json(other)['foreign'], [1, 2])
        self.assertEqual(cp.load_json(other)['pending'], ['do-not-delete'])

    def test_unknown_fields_survive_ingest_and_status_record(self):
        d = cp.load_json(self.path); d['foreign'] = {'kept': True}; d[cp.NAMESPACE]['future'] = ['keep']
        cp.atomic_write(self.path, d)
        event = self.change(latest_incoming_id='message-b')['pending'][0]['event_id']
        cp.record(self.path, event, 'pending', 'uncertain', 'ledger:one')
        d = cp.load_json(self.path)
        self.assertEqual(d['foreign'], {'kept': True})
        self.assertEqual(d[cp.NAMESPACE]['future'], ['keep'])

    def test_read_closure_state_only_preserves_existing_work_and_promise_history(self):
        first = self.change(latest_incoming_id='message-b')
        after = dict(self.base['ticket:synthetic'], latest_incoming_id='message-b', read=True, requires_reply=False)
        result = cp.ingest(self.path, envelope({'ticket:synthetic': after}))
        self.assertEqual(result['pending'], first['pending'])
        self.assertEqual(result['state_only_count'], 1)
        history = list(self.state()['outbox'].values())
        self.assertTrue(all(e['before']['technical_promise'] == 'investigate paid recording' for e in history))
        close = next(e for e in history if e['kind'] == 'state_only')
        with self.assertRaises(cp.CheckpointError):
            cp.record(self.path, close['event_id'], 'state_only', 'dispatching', 'ledger:no')

    def test_new_incoming_even_read_closed_is_pending_internal_review(self):
        result = self.change(latest_incoming_id='message-b', read=True, requires_reply=False)
        self.assertEqual(len(result['pending']), 1)
        self.assertEqual(result['pending'][0]['kind'], 'metadata_changed')

    def test_removal_is_durable_administrative_review_preserving_uncertain(self):
        event = self.change(latest_incoming_id='message-b')['pending'][0]['event_id']
        cp.record(self.path, event, 'pending', 'uncertain', 'ledger:held')
        result = cp.ingest(self.path, envelope({}))
        self.assertEqual(result['in_flight'][0]['event_id'], event)
        self.assertEqual(result['blocked_pending'][0]['kind'], 'administrative_review')
        self.assertEqual(cp.ingest(self.path, envelope({}))['blocked_pending'], result['blocked_pending'])

    def test_bot_disable_and_reopen_are_review_not_state_only(self):
        for fields in [{'support_enabled': False}, {'active': False}, {'status': 'open'}, {'read': False, 'requires_reply': True, 'updated_at': 'new'}]:
            with self.subTest(fields=fields):
                result = self.change(**fields)
                self.assertGreaterEqual(len(result['pending']), 1)
                self.assertEqual(result['pending'][-1]['kind'], 'metadata_changed')

    def test_aba_has_distinct_revisions_and_repeat_noop_has_no_new_event(self):
        a = self.change(latest_incoming_id='message-b')['pending'][0]['event_id']
        cp.ingest(self.path, envelope(self.base))
        result = self.change(latest_incoming_id='message-b')
        self.assertEqual([e['revision'] for e in result['pending']], [1, 2, 3])
        self.assertNotEqual(result['pending'][-1]['event_id'], a)
        self.assertEqual(self.change(latest_incoming_id='message-b')['pending'], result['pending'])

    def test_corrupt_checkpoint_fails_closed(self):
        d = cp.load_json(self.path); d[cp.NAMESPACE]['signatures']['ticket:synthetic'] = 'corrupt'
        self.path.write_text(json.dumps(d)); before = self.path.read_bytes()
        with self.assertRaises(cp.CheckpointError):
            self.change(latest_incoming_id='message-b')
        self.assertEqual(self.path.read_bytes(), before)

    def test_concurrent_writers_keep_both_revisions(self):
        context = multiprocessing.get_context('fork')
        workers = [context.Process(target=ingest_process, args=(self.path, value)) for value in ('message-b', 'message-c')]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(10)
            self.assertEqual(worker.exitcode, 0)
        self.assertEqual(sorted(e['revision'] for e in self.state()['outbox'].values()), [1, 2])
        self.assertEqual(len(cp.pending(self.path)['pending']), 2)

    def test_cli_invalid_input_returns_failure_without_advancing(self):
        snap = Path(self.temp.name) / 'partial.json'; snap.write_text('{"complete":false}')
        before = self.path.read_bytes()
        done = subprocess.run([sys.executable, str(SCRIPT), '--checkpoint', str(self.path),
                               'ingest', '--snapshot', str(snap)], capture_output=True, text=True)
        self.assertEqual(done.returncode, 2)
        self.assertEqual(json.loads(done.stderr)['outcome'], 'not_confirmed')
        self.assertEqual(self.path.read_bytes(), before)

    def test_reopened_flags_remain_pending_even_with_another_closing_flag(self):
        closed = {'ticket:synthetic': {'latest_incoming_id': 'same', 'read': True, 'requires_reply': False}}
        cp.ingest(self.path, envelope(closed))
        count = len(self.state()['outbox'])
        cp.ingest(self.path, envelope({'ticket:synthetic': {'latest_incoming_id': 'same', 'read': False, 'requires_reply': False}}))
        event = list(self.state()['outbox'].values())[-1]
        self.assertEqual(event['kind'], 'metadata_changed')
        cp.ingest(self.path, envelope(closed))
        cp.ingest(self.path, envelope({'ticket:synthetic': {'latest_incoming_id': 'same', 'read': True, 'requires_reply': True}}))
        self.assertEqual(list(self.state()['outbox'].values())[-1]['kind'], 'metadata_changed')
        self.assertGreater(len(self.state()['outbox']), count)

    def test_missing_incoming_id_cannot_be_treated_as_safe_read_closure(self):
        cp.ingest(self.path, envelope({'other': {'read': False}}))
        cp.ingest(self.path, envelope({'other': {'read': True}}))
        self.assertEqual(list(self.state()['outbox'].values())[-1]['kind'], 'metadata_changed')

    def test_bounded_output_stable_full_state_and_progress_after_verification(self):
        cp.ingest(self.path, envelope({f'ticket:{i:03}': {'latest_incoming_id': 'new'} for i in range(25)}))
        first = cp.pending(self.path)
        self.assertEqual(sum(len(first[name]) for name in ('pending', 'blocked_pending', 'in_flight')), 10)
        self.assertTrue(first['has_more'])
        self.assertEqual(first['counts']['pending'], 26)  # includes removed original
        self.assertEqual(cp.pending(self.path), first)
        acknowledged = {event['event_id'] for event in first['pending']}
        for ident in acknowledged:
            cp.record(self.path, ident, 'pending', 'verified', 'ledger:checked:' + ident)
        second = cp.pending(self.path)
        self.assertEqual(second['counts']['pending'], 16)
        self.assertFalse(acknowledged & {event['event_id'] for event in second['pending']})
        self.assertEqual(len(self.state()['outbox']), 26)

    def test_boolean_numeric_metadata_change_is_not_lost(self):
        cp.ingest(self.path, envelope({'numeric': {'value': 1}}))
        result = cp.ingest(self.path, envelope({'numeric': {'value': True}}))
        self.assertEqual(result['changed'], 1)

    def test_status_cas_and_same_ledger_entry_are_required(self):
        event = self.change(latest_incoming_id='message-b')['pending'][0]['event_id']
        with self.assertRaises(cp.CheckpointError):
            cp.record(self.path, event, 'uncertain', 'verified', 'ledger:one')
        cp.record(self.path, event, 'pending', 'dispatching', 'ledger:one')
        before = self.path.read_bytes()
        with self.assertRaises(cp.CheckpointError):
            cp.record(self.path, event, 'dispatching', 'api_accepted', 'ledger:two')
        self.assertEqual(self.path.read_bytes(), before)

    def test_ids_are_deterministic_across_identical_checkpoints(self):
        other = Path(self.temp.name) / 'other.json'
        cp.initialize(other, envelope(self.base), 'another-verified-reference')
        result = self.change(latest_incoming_id='message-b')
        second = cp.ingest(other, envelope({'ticket:synthetic': dict(self.base['ticket:synthetic'], latest_incoming_id='message-b')}))
        self.assertEqual(result['pending'], second['pending'])


if __name__ == '__main__':
    unittest.main()
