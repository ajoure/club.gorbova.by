import base64
import json
import unittest

from pglast import parse_sql

from auth_restore_dryrun import GateFailed
from copy_fence import (EXPECTED_FENCED_FUNCTIONS, FENCED_VALUE, SOURCE, TARGET_ORIGIN,
                        fence_phase, validate_fence)


def jwt(ref):
    part = lambda value: base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    return part({'alg': 'HS256'}) + '.' + part({'iss': 'supabase', 'ref': ref, 'role': 'anon'}) + '.c2lnbmF0dXJl'


def function(name, body, returns='bigint'):
    text = ('CREATE FUNCTION ' + name + '() RETURNS ' + returns + ' LANGUAGE plpgsql AS $$\n'
            + body + '\nBEGIN RETURN NULL; END;\n$$;')
    return ('CreateFunctionStmt', text, parse_sql(text)[0].stmt)


URL = "'https://" + SOURCE + ".supabase.co/functions/v1/worker'"


def reviewed_set():
    items = []
    for name, credentials in EXPECTED_FENCED_FUNCTIONS.items():
        body = 'DECLARE v_url text := ' + URL + ';'
        if name == 'public.notify_admins_on_ticket_message':
            body += "\n  v_anon text := '" + jwt(SOURCE) + "';"
        if name == 'public.trigger_card_verification':
            body += "\n  v_cron_secret text;\nBEGIN v_cron_secret := 'not-a-real-secret'; END;"
        items.append(function(name, body))
    return items


class CopyFenceTest(unittest.TestCase):
    def test_reviewed_functions_point_to_target_without_source_credentials(self):
        fenced = {}
        result = fence_phase(reviewed_set(), fenced)
        self.assertEqual(validate_fence(fenced), dict(functions=8, credentials_removed=2))
        for _, text, _ in result:
            self.assertNotIn(SOURCE, text)
            self.assertIn(TARGET_ORIGIN, text)
            self.assertNotIn('not-a-real-secret', text)
            self.assertNotIn('eyJ', text)
        self.assertEqual(sum(FENCED_VALUE in text for _, text, _ in result), 2)

    def test_unreviewed_function_with_source_reference_refused(self):
        with self.assertRaisesRegex(GateFailed, 'unreviewed_source_reference_in_function'):
            fence_phase([function('public.new_worker', 'DECLARE v text := ' + URL + ';')], {})

    def test_source_reference_outside_function_refused(self):
        text = "COMMENT ON SCHEMA public IS 'https://" + SOURCE + ".supabase.co';"
        with self.assertRaisesRegex(GateFailed, 'source_reference_outside_function'):
            fence_phase([('CommentStmt', text, parse_sql(text)[0].stmt)], {})

    def test_source_jwt_without_source_url_refused(self):
        item = function('public.other', "DECLARE k text := '" + jwt(SOURCE) + "';")
        with self.assertRaisesRegex(GateFailed, 'source_credential_outside_reviewed_function'):
            fence_phase([item], {})

    def test_foreign_jwt_inside_fenced_function_refused(self):
        item = function('public.notify_admins_on_ticket_message',
                        'DECLARE v text := ' + URL + ";\n  k text := '" + jwt('someoneelse') + "';")
        with self.assertRaisesRegex(GateFailed, 'unreviewed_jwt_literal_in_fenced_function'):
            fence_phase([item], {})

    def test_credential_count_drift_refused(self):
        item = function('public.trigger_card_verification', 'DECLARE v text := ' + URL + ';')
        with self.assertRaisesRegex(GateFailed, 'fenced_function_credential_count_mismatch'):
            fence_phase([item], {})

    def test_missing_reviewed_function_refused(self):
        fenced = {}
        fence_phase(reviewed_set()[1:], fenced)
        with self.assertRaisesRegex(GateFailed, 'fenced_function_set_drift'):
            validate_fence(fenced)

    def test_duplicate_definition_refused(self):
        items = reviewed_set()
        with self.assertRaisesRegex(GateFailed, 'fenced_function_defined_twice'):
            fence_phase(items + items[:1], {})

    def test_unrelated_statements_untouched(self):
        item = function('public.plain', "DECLARE v_key text := 'company:' || 'x';")
        self.assertEqual(fence_phase([item], {}), [item])


if __name__ == '__main__':
    unittest.main()
