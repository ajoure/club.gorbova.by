#!/usr/bin/env python3
"""Local metadata baseline + durable outbox. No network or external dispatch."""
import argparse
import copy
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

NAMESPACE = 'support_metadata_checkpoint'
SCHEMA_VERSION = 1
STATE_FIELDS = frozenset({'read', 'is_read', 'read_at', 'last_read_at', 'requires_reply',
                          'unread', 'is_unread', 'unread_count', 'status'})
BLOCKED = frozenset({'dispatching', 'api_accepted', 'uncertain'})
STATUSES = frozenset({'pending', 'state_only', 'dispatching', 'api_accepted', 'uncertain', 'verified'})
TRANSITIONS = {
    'pending': {'dispatching', 'api_accepted', 'uncertain', 'verified'},
    'dispatching': {'api_accepted', 'uncertain', 'verified'},
    'api_accepted': {'uncertain', 'verified'},
    'uncertain': {'verified'}, 'verified': set(), 'state_only': set(),
}


class CheckpointError(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CheckpointError('duplicate JSON object key')
        result[key] = value
    return result


def load_json(path):
    with Path(path).open(encoding='utf-8') as stream:
        return json.load(stream, object_pairs_hook=unique_object,
                         parse_constant=lambda _: (_ for _ in ()).throw(CheckpointError('nonfinite JSON number')))


def snapshot_rows(envelope):
    if not isinstance(envelope, dict) or envelope.get('complete') is not True \
            or envelope.get('pagination_complete') is not True \
            or envelope.get('error') not in (None, False) \
            or envelope.get('errors') not in (None, []) \
            or envelope.get('success') is False \
            or envelope.get('status') not in (None, 'success', 'complete', 'completed') \
            or envelope.get('next_cursor') not in (None, '') \
            or not isinstance(envelope.get('rows'), list):
        raise CheckpointError('complete error-free paginated snapshot required')
    rows = {}
    for row in envelope['rows']:
        if not isinstance(row, dict) or not isinstance(row.get('metadata_key'), str) \
                or not row['metadata_key'].strip() or not isinstance(row.get('metadata'), dict):
            raise CheckpointError('invalid metadata row')
        key = row['metadata_key']
        if key in rows:
            raise CheckpointError('duplicate metadata_key')
        canonical(row['metadata'])  # Reject unsupported values before acquiring state.
        rows[key] = copy.deepcopy(row['metadata'])
    return rows


def event_id(key, revision, before_signature, after_signature):
    return 'support-metadata:' + digest([SCHEMA_VERSION, key, revision, before_signature, after_signature])


def validate_state(document):
    if not isinstance(document, dict):
        raise CheckpointError('checkpoint must be a JSON object')
    state = document.get(NAMESPACE)
    if not isinstance(state, dict) or state.get('schema_version') != SCHEMA_VERSION:
        raise CheckpointError('explicit initialization required / unsupported checkpoint version')
    for field in ('baseline', 'signatures', 'revisions', 'outbox'):
        if not isinstance(state.get(field), dict):
            raise CheckpointError('invalid checkpoint structure')
    if not isinstance(state.get('baseline_ref'), str) or not state['baseline_ref'].strip():
        raise CheckpointError('missing verified baseline reference')
    for key, value in state['baseline'].items():
        if not isinstance(key, str) or not key.strip() or not isinstance(value, dict) \
                or state['signatures'].get(key) != digest(value):
            raise CheckpointError('baseline/signature mismatch')
    if set(state['signatures']) != set(state['baseline']):
        raise CheckpointError('baseline/signature keys mismatch')
    for key, revision in state['revisions'].items():
        if not isinstance(key, str) or not key.strip() or type(revision) is not int or revision < 0:
            raise CheckpointError('invalid revision')
    if not set(state['baseline']) <= set(state['revisions']):
        raise CheckpointError('missing baseline revision')
    for ident, event in state['outbox'].items():
        if not isinstance(event, dict) or event.get('status') not in STATUSES:
            raise CheckpointError('invalid outbox event/status')
        key, revision = event.get('metadata_key'), event.get('revision')
        if not isinstance(key, str) or type(revision) is not int or revision < 1 \
                or revision > state['revisions'].get(key, -1):
            raise CheckpointError('invalid event revision')
        if event.get('kind') not in ('metadata_changed', 'state_only', 'administrative_review'):
            raise CheckpointError('invalid event kind')
        for side in ('before', 'after'):
            value = event.get(side)
            if value is not None and not isinstance(value, dict):
                raise CheckpointError('invalid event metadata')
            if event.get(side + '_signature') != (None if value is None else digest(value)):
                raise CheckpointError('invalid event signature')
        if ident != event.get('event_id') or ident != event_id(key, revision, event['before_signature'], event['after_signature']):
            raise CheckpointError('invalid event identity')
        if event['kind'] == 'state_only' and event['status'] != 'state_only':
            raise CheckpointError('state-only event cannot dispatch')
        if event['status'] in BLOCKED | {'verified'} and not event.get('ledger_ref'):
            raise CheckpointError('missing authoritative ledger reference')
    return state


def pending_result(document, operation, changed=0, limit=10):
    if type(limit) is not int or not 1 <= limit <= 100:
        raise CheckpointError('limit must be between 1 and 100')
    state = validate_state(document)
    blocked_keys = {e['metadata_key'] for e in state['outbox'].values() if e['status'] in BLOCKED}
    events = sorted(state['outbox'].values(), key=lambda e: (e['metadata_key'], e['revision']))
    # Full metadata stays only in checkpoint; stdout is a compact routing receipt.
    brief = lambda e: {k: e[k] for k in ('event_id', 'metadata_key', 'revision', 'kind', 'status')}
    groups = {
        'pending': [e for e in events if e['status'] == 'pending' and e['metadata_key'] not in blocked_keys],
        'blocked_pending': [e for e in events if e['status'] == 'pending' and e['metadata_key'] in blocked_keys],
        'in_flight': [e for e in events if e['status'] in BLOCKED],
    }
    result = {'operation': operation, 'changed': changed,
              'counts': {name: len(values) for name, values in groups.items()},
              'state_only_count': sum(e['status'] == 'state_only' for e in events),
              'legacy_outbox_present': any(k in document for k in ('pending', 'outbox', 'uncertain'))}
    remaining = limit
    for name, values in groups.items():
        result[name] = [brief(e) for e in values[:remaining]]
        remaining -= len(result[name])
    result['has_more'] = sum(result['counts'].values()) > limit
    return result


@contextmanager
def checkpoint_lock(path):
    # Never lock the replaceable checkpoint inode. All cooperating writers lock
    # this stable sibling, held across read/validate/replace/directory fsync.
    path = Path(path)
    if path.is_symlink():
        raise CheckpointError('symlink checkpoint unsupported')
    flags = os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(str(path) + '.lock', flags, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        if path.is_symlink():
            raise CheckpointError('symlink checkpoint unsupported')
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def atomic_write(path, document):
    path = Path(path)
    encoded = (canonical(document) + '\n').encode('utf-8')
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        # If this fails after replacement, outcome is uncertain: caller must
        # read the same checkpoint, never assume that old bytes survived.
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def initialize(path, envelope, baseline_ref, legacy=None):
    rows = snapshot_rows(envelope)
    if not isinstance(baseline_ref, str) or not baseline_ref.strip():
        raise CheckpointError('verified baseline reference required')
    with checkpoint_lock(path):
        if Path(path).exists():
            if legacy is not None:
                raise CheckpointError('cannot overlay existing checkpoint with legacy file')
            document = load_json(path)
        else:
            document = copy.deepcopy(legacy) if legacy is not None else {}
        if not isinstance(document, dict) or NAMESPACE in document:
            raise CheckpointError('already initialized or invalid legacy state')
        document[NAMESPACE] = {'schema_version': SCHEMA_VERSION, 'baseline_ref': baseline_ref,
                               'baseline': rows, 'signatures': {k: digest(v) for k, v in rows.items()},
                               'revisions': {k: 0 for k in rows}, 'outbox': {}}
        validate_state(document)
        atomic_write(path, document)
        result = pending_result(document, 'initialized')
        result['baseline_rows'] = len(rows)
        result['not_a_no_changes_check'] = True
        return result


def state_only_change(before, after):
    # Fail closed unless a stable latest incoming ID establishes the same work.
    incoming = before.get('latest_incoming_id')
    if not isinstance(incoming, str) or not incoming.strip() or after.get('latest_incoming_id') != incoming:
        return False
    changed = {key for key in before.keys() | after.keys()
               if (key in before, canonical(before.get(key))) != (key in after, canonical(after.get(key)))}
    if not changed & STATE_FIELDS or not changed <= STATE_FIELDS | {'updated_at'}:
        return False
    # Every changed flag must move toward closure; one closing flag must not
    # hide a different reopening flag in the same snapshot.
    for key in changed - {'updated_at'}:
        value = after.get(key)
        if key in ('read', 'is_read') and value is not True:
            return False
        if key in ('requires_reply', 'unread', 'is_unread') and value is not False:
            return False
        if key == 'status' and value not in ('closed', 'resolved', 'read', 'done'):
            return False
        if key in ('read_at', 'last_read_at') and (not isinstance(value, str) or not value
                                                  or (before.get(key) and value < before[key])):
            return False
        if key == 'unread_count' and (type(value) is not int or value != 0):
            return False
    return True


def ingest(path, envelope):
    rows = snapshot_rows(envelope)
    with checkpoint_lock(path):
        document = load_json(path)
        state = validate_state(document)
        baseline = state['baseline']
        changed = 0
        for key in sorted(baseline.keys() | rows.keys()):
            before, after = baseline.get(key), rows.get(key)
            if canonical(before) == canonical(after):
                continue
            revision = state['revisions'].get(key, 0) + 1
            old_sig = None if before is None else digest(before)
            new_sig = None if after is None else digest(after)
            kind = 'administrative_review' if after is None else ('state_only' if before is not None and state_only_change(before, after) else 'metadata_changed')
            ident = event_id(key, revision, old_sig, new_sig)
            if ident in state['outbox']:
                raise CheckpointError('outbox revision collision')
            state['outbox'][ident] = {'event_id': ident, 'metadata_key': key, 'revision': revision,
                                     'before': before, 'after': after, 'before_signature': old_sig,
                                     'after_signature': new_sig, 'kind': kind,
                                     'status': 'state_only' if kind == 'state_only' else 'pending'}
            state['revisions'][key] = revision
            changed += 1
        state['baseline'] = rows
        state['signatures'] = {k: digest(v) for k, v in rows.items()}
        validate_state(document)
        if changed:
            atomic_write(path, document)
        return pending_result(document, 'ingested' if changed else 'noop', changed)


def pending(path, limit=10):
    with checkpoint_lock(path):
        return pending_result(load_json(path), 'pending', limit=limit)


def record(path, ident, expected_status, status, ledger_ref):
    if status not in STATUSES or not isinstance(ledger_ref, str) or not ledger_ref.strip():
        raise CheckpointError('valid status and authoritative handoff ledger reference required')
    with checkpoint_lock(path):
        document = load_json(path)
        state = validate_state(document)
        event = state['outbox'].get(ident)
        if event is None:
            raise CheckpointError('unknown event')
        if event['status'] == status and event.get('ledger_ref') == ledger_ref:
            return pending_result(document, 'already_recorded')
        if event.get('ledger_ref') and event['ledger_ref'] != ledger_ref:
            raise CheckpointError('authoritative ledger entry is immutable; reconcile same handle')
        if event['status'] != expected_status or status not in TRANSITIONS[event['status']]:
            raise CheckpointError('status CAS/transition rejected; reconcile same handoff ledger entry')
        if status == 'dispatching' and any(e['metadata_key'] == event['metadata_key'] and e['status'] in BLOCKED
                                           for e in state['outbox'].values()):
            raise CheckpointError('unresolved handoff already exists for metadata_key')
        event['status'] = status
        event['ledger_ref'] = ledger_ref
        validate_state(document)
        atomic_write(path, document)
        return pending_result(document, 'recorded')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--checkpoint', required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    init = commands.add_parser('init')
    init.add_argument('--snapshot', required=True)
    init.add_argument('--baseline-ref', required=True)
    init.add_argument('--legacy')
    commands.add_parser('ingest').add_argument('--snapshot', required=True)
    commands.add_parser('pending').add_argument('--limit', type=int, default=10)
    mark = commands.add_parser('record')
    for name in ('event-id', 'expected-status', 'status', 'ledger-ref'):
        mark.add_argument('--' + name, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == 'init':
            result = initialize(args.checkpoint, load_json(args.snapshot), args.baseline_ref,
                                load_json(args.legacy) if args.legacy else None)
        elif args.command == 'ingest':
            result = ingest(args.checkpoint, load_json(args.snapshot))
        elif args.command == 'pending':
            result = pending(args.checkpoint, args.limit)
        else:
            result = record(args.checkpoint, args.event_id, args.expected_status, args.status, args.ledger_ref)
        print(canonical(result))
        return 0
    except (OSError, ValueError, TypeError) as exc:
        # Avoid payloads/paths in logs; post-replace failures require read-back.
        print(canonical({'error': type(exc).__name__, 'outcome': 'not_confirmed',
                         'next': 'read same checkpoint and authoritative handoff ledger; do not dispatch/retry blindly'}), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
