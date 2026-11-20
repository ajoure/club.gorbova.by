"""Fence source-production side effects out of the copy schema.

The archive contains eight SQL functions that call the source (Lovable) backend
through pg_net with embedded source credentials. A copy that keeps them would
send real notifications, card verifications, broadcasts and worker runs to
production. Each such function is rewritten to address our own project and
lose every embedded source credential. Anything outside the reviewed set that
still mentions the source project is refused, never silently rewritten.

No network, credentials or database I/O. Secret values are never returned.
"""
import base64
import json
import re

from pglast import parse_sql

from auth_restore_dryrun import TARGET, GateFailed

SOURCE = 'hdjgkjceownmmnrqqtuz'
SOURCE_ORIGIN = 'https://' + SOURCE + '.supabase.co'
TARGET_ORIGIN = 'https://' + TARGET + '.supabase.co'
FENCED_VALUE = 'fenced-by-gorbova-copy'

# Reviewed 20.11.2026 against archive sha256 46cde5f3…a780e: name -> number of
# embedded source credentials removed (anon JWT / hard-coded cron secret).
EXPECTED_FENCED_FUNCTIONS = {
    'public.invoke_bepaid_webhook_realtime_queue': 0,
    'public.invoke_instagram_monitor_worker': 0,
    'public.invoke_process_scheduled_broadcasts': 0,
    'public.invoke_referral_redemption_worker': 0,
    'public.invoke_sales_runtime_worker': 0,
    'public.invoke_telegram_daily_summary': 0,
    'public.notify_admins_on_ticket_message': 1,
    'public.trigger_card_verification': 1,
}

JWT_LITERAL = re.compile(r"'(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)'")
CRON_SECRET_LITERAL = re.compile(r"(v_cron_secret\s*:=\s*)'[^']*'")


def _jwt_ref(token):
    try:
        payload = token.split('.')[1]
        data = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    except (ValueError, IndexError):
        return None
    return data.get('ref') if isinstance(data, dict) else None


def _function_name(node):
    return '.'.join(item.sval for item in node.funcname)


def fence_function(kind, statement, node):
    """Return (kind, statement, node, credentials_removed) for one function."""
    name = _function_name(node)
    if name not in EXPECTED_FENCED_FUNCTIONS:
        raise GateFailed('unreviewed_source_reference_in_function')
    removed = 0

    def drop_jwt(match):
        nonlocal removed
        if _jwt_ref(match[1]) != SOURCE:
            raise GateFailed('unreviewed_jwt_literal_in_fenced_function')
        removed += 1
        return "'" + FENCED_VALUE + "'"

    text = statement.replace(SOURCE_ORIGIN, TARGET_ORIGIN)
    text = JWT_LITERAL.sub(drop_jwt, text)
    text, secrets = CRON_SECRET_LITERAL.subn(lambda m: m[1] + "'" + FENCED_VALUE + "'", text)
    removed += secrets
    if removed != EXPECTED_FENCED_FUNCTIONS[name]:
        raise GateFailed('fenced_function_credential_count_mismatch')
    if SOURCE in text:
        raise GateFailed('source_reference_survived_fence')
    parsed = parse_sql(text)
    if len(parsed) != 1 or type(parsed[0].stmt).__name__ != kind or _function_name(parsed[0].stmt) != name:
        raise GateFailed('fenced_function_reparse_mismatch')
    return kind, text, parsed[0].stmt, removed


def fence_phase(statements, fenced):
    """Rewrite reviewed functions; refuse any other source reference.

    `fenced` collects name -> credentials removed across phases.
    """
    result = []
    for kind, statement, node in statements:
        if SOURCE in statement:
            if kind != 'CreateFunctionStmt':
                raise GateFailed('source_reference_outside_function')
            kind, statement, node, removed = fence_function(kind, statement, node)
            name = _function_name(node)
            if name in fenced:
                raise GateFailed('fenced_function_defined_twice')
            fenced[name] = removed
        elif JWT_LITERAL.search(statement) and any(_jwt_ref(m) == SOURCE for m in JWT_LITERAL.findall(statement)):
            raise GateFailed('source_credential_outside_reviewed_function')
        result.append((kind, statement, node))
    return result


def validate_fence(fenced):
    if fenced != EXPECTED_FENCED_FUNCTIONS:
        raise GateFailed('fenced_function_set_drift')
    return dict(functions=len(fenced), credentials_removed=sum(fenced.values()))
