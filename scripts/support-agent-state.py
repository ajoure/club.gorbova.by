#!/usr/bin/env python3
"""Local idempotency journal for the Codex support heartbeat, without customer data.

This program does not access the network, send messages or grant entitlements.
An interrupted action stays reserved until its result is checked in the application.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import time
import uuid

DEFAULT_STATE = Path('/Users/fs/CodexWorkspace/State/gorbova-auto-support')
OPERATIONS = ('reply', 'handoff', 'restore_access', 'resend_invite', 'close_ticket',
              'react_heart', 'mark_read', 'mark_unread', 'create_payment_link')
OUTCOMES = ('verified', 'uncertain', 'not_executed')


def connect(folder):
    folder = Path(folder)
    folder.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(folder, 0o700)
    path = folder / 'journal.sqlite3'
    db = sqlite3.connect(path, timeout=10, isolation_level=None)
    os.chmod(path, 0o600)
    db.executescript('''
      CREATE TABLE IF NOT EXISTS runs (
        slot INTEGER PRIMARY KEY CHECK(slot=1), token TEXT NOT NULL,
        expires_at REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS actions (
        fingerprint TEXT PRIMARY KEY, operation TEXT NOT NULL,
        status TEXT NOT NULL, run_token TEXT NOT NULL, updated_at REAL NOT NULL
      );
    ''')
    return db


def fingerprint(source, message_id, operation):
    # Only opaque IDs, never a name, email, message text, URL or payment details.
    normalized = str(uuid.UUID(message_id))
    if source not in ('telegram', 'ticket', 'instagram') or operation not in OPERATIONS:
        raise ValueError('invalid_scope')
    return hashlib.sha256(f'{source}:{normalized}:{operation}'.encode()).hexdigest()


def run_command(db, command, token=None, source=None, message_id=None,
                operation=None, outcome=None, now=None):
    now = time.time() if now is None else now
    db.execute('BEGIN IMMEDIATE')
    try:
        row = db.execute('SELECT token, expires_at FROM runs WHERE slot=1').fetchone()
        if command == 'begin':
            if row and row[1] > now:
                return {'ok': False, 'reason': 'another_run_active'}
            new_token = str(uuid.uuid4())
            db.execute('INSERT OR REPLACE INTO runs VALUES (1, ?, ?)', (new_token, now + 1800))
            return {'ok': True, 'run_token': new_token, 'lease_seconds': 1800}
        if command == 'status':
            counts = dict(db.execute('SELECT status, count(*) FROM actions GROUP BY status').fetchall())
            return {'ok': True, 'run_active': bool(row and row[1] > now), 'actions': counts}
        if not row or row[0] != token or row[1] <= now:
            return {'ok': False, 'reason': 'run_lease_missing_or_expired'}
        if command == 'renew':
            db.execute('UPDATE runs SET expires_at=? WHERE slot=1', (now + 1800,))
            return {'ok': True}
        if command == 'end':
            db.execute('DELETE FROM runs WHERE slot=1')
            return {'ok': True}
        key = fingerprint(source, message_id, operation)
        existing = db.execute('SELECT status FROM actions WHERE fingerprint=?', (key,)).fetchone()
        if command == 'reserve':
            if existing and existing[0] != 'not_executed':
                return {'ok': False, 'reason': 'already_reserved_check_application', 'status': existing[0]}
            db.execute('INSERT OR REPLACE INTO actions VALUES (?, ?, ?, ?, ?)',
                       (key, operation, 'reserved', token, now))
            return {'ok': True, 'fingerprint': key}
        if command == 'record':
            if not existing or outcome not in OUTCOMES:
                return {'ok': False, 'reason': 'reservation_and_valid_outcome_required'}
            if existing[0] == 'verified' and outcome != 'verified':
                return {'ok': False, 'reason': 'verified_action_cannot_be_reopened'}
            db.execute('UPDATE actions SET status=?, run_token=?, updated_at=? WHERE fingerprint=?',
                       (outcome, token, now, key))
            return {'ok': True, 'status': outcome}
        raise ValueError('invalid_command')
    finally:
        db.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('begin', 'renew', 'end', 'status', 'reserve', 'record'))
    parser.add_argument('--state-dir', type=Path, default=DEFAULT_STATE)
    parser.add_argument('--run-token')
    parser.add_argument('--source', choices=('telegram', 'ticket', 'instagram'))
    parser.add_argument('--message-id')
    parser.add_argument('--operation', choices=OPERATIONS)
    parser.add_argument('--outcome', choices=OUTCOMES)
    args = parser.parse_args()
    if args.command in ('reserve', 'record') and not all((args.source, args.message_id, args.operation)):
        parser.error('source, message-id and operation are required')
    with connect(args.state_dir) as db:
        try:
            result = run_command(db, args.command, args.run_token, args.source,
                                 args.message_id, args.operation, args.outcome)
        except (ValueError, AttributeError):
            result = {'ok': False, 'reason': 'invalid_opaque_id_or_scope'}
    print(json.dumps(result))


if __name__ == '__main__':
    main()
