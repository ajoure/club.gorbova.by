import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('support_state', Path(__file__).with_name('support-agent-state.py'))
state = importlib.util.module_from_spec(spec)
spec.loader.exec_module(state)


class SupportStateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = state.connect(self.tmp.name)
        self.token = state.run_command(self.db, 'begin', now=100)['run_token']
        self.scope = dict(source='telegram', message_id='11111111-1111-4111-8111-111111111111', operation='reply')

    def tearDown(self):
        self.db.close()
        self.tmp.cleanup()

    def action(self, command, **kwargs):
        return state.run_command(self.db, command, token=self.token, now=101, **self.scope, **kwargs)

    def test_second_process_cannot_start_or_send(self):
        other = state.connect(self.tmp.name)
        self.assertFalse(state.run_command(other, 'begin', now=101)['ok'])
        self.assertFalse(state.run_command(other, 'reserve', token='wrong', now=101, **self.scope)['ok'])
        other.close()

    def test_reservation_survives_process_restart_and_expired_run(self):
        self.assertTrue(self.action('reserve')['ok'])
        self.db.close()
        self.db = state.connect(self.tmp.name)
        token2 = state.run_command(self.db, 'begin', now=2000)['run_token']
        result = state.run_command(self.db, 'reserve', token=token2, now=2001, **self.scope)
        self.assertFalse(result['ok'])
        self.assertEqual(result['status'], 'reserved')

    def test_uncertain_send_never_automatically_retries(self):
        self.action('reserve')
        self.action('record', outcome='uncertain')
        self.assertFalse(self.action('reserve')['ok'])

    def test_only_proven_not_executed_can_be_retried(self):
        self.action('reserve')
        self.action('record', outcome='not_executed')
        self.assertTrue(self.action('reserve')['ok'])

    def test_verified_action_cannot_be_reopened(self):
        self.action('reserve')
        self.action('record', outcome='verified')
        self.assertFalse(self.action('record', outcome='not_executed')['ok'])
        self.assertFalse(self.action('reserve')['ok'])

    def test_channels_are_independent_but_no_raw_identifiers_are_retained(self):
        self.action('reserve')
        self.assertTrue(state.run_command(self.db, 'reserve', token=self.token, now=101,
            **{**self.scope, 'source': 'ticket'})['ok'])
        dump = '\n'.join(self.db.iterdump())
        self.assertNotIn(self.scope['message_id'], dump)
        with self.assertRaises(ValueError):
            state.fingerprint('telegram', 'person@example.com', 'reply')

    def test_expired_worker_cannot_write(self):
        self.assertFalse(state.run_command(self.db, 'reserve', token=self.token, now=2000, **self.scope)['ok'])

    def test_end_does_not_drop_unverified_action(self):
        self.action('reserve')
        state.run_command(self.db, 'end', token=self.token, now=102)
        self.token = state.run_command(self.db, 'begin', now=103)['run_token']
        self.assertFalse(state.run_command(self.db, 'reserve', token=self.token, now=104, **self.scope)['ok'])


if __name__ == '__main__':
    unittest.main()
