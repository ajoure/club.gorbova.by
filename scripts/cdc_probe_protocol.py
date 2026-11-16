"""Strict wal2json v2 fixture protocol. No network, credentials or database I/O."""
import hashlib
import json
import re
from dataclasses import dataclass
from decimal import Decimal

from auth_restore_dryrun import GateFailed


def lsn(value):
    if not isinstance(value, str) or not re.fullmatch(r'[0-9A-F]{1,8}/[0-9A-F]{1,8}', value):
        raise GateFailed('invalid_commit_lsn')
    high, low = value.split('/')
    return (int(high, 16) << 32) + int(low, 16)


@dataclass(frozen=True)
class Transaction:
    xid: str
    commit_lsn: str  # End of the COMMIT record: wal2json C.nextlsn, not C.lsn.
    events: tuple
    digest: str


def transactions(records, schema):
    """Reject partial/foreign transactions before applying anything.

    Commit order is authoritative. Individual change LSNs in a long-running
    transaction can precede the already acknowledged short transaction.
    """
    result, events, encoded = [], None, []
    xid, previous = None, -1
    for raw in records:
        try:
            value = json.loads(raw, parse_float=Decimal)
        except (ValueError, TypeError):
            raise GateFailed('invalid_decoding_json') from None
        if not isinstance(value, dict):
            raise GateFailed('invalid_decoding_record')
        action = value.get('action')
        if action == 'B':
            if events is not None or not str(value.get('xid', '')).isdigit():
                raise GateFailed('invalid_transaction_begin')
            xid, events, encoded = str(value['xid']), [], [raw]
        elif action == 'C':
            if events is None or str(value.get('xid')) != xid:
                raise GateFailed('invalid_transaction_commit')
            end = value.get('nextlsn')
            position = lsn(end)
            if position <= previous or ('lsn' in value and lsn(value['lsn']) > position):
                raise GateFailed('commit_order_violation')
            encoded.append(raw)
            result.append(Transaction(xid, end, tuple(events), hashlib.sha256('\n'.join(encoded).encode()).hexdigest()))
            previous, events, xid = position, None, None
        elif action in {'I', 'U', 'D', 'T'}:
            if events is None or ('xid' in value and str(value['xid']) != xid):
                raise GateFailed('change_outside_transaction')
            if value.get('schema') != schema or value.get('table') not in {'src_pk', 'src_bag'}:
                raise GateFailed('foreign_change_refused')
            events.append(value)
            encoded.append(raw)
        else:
            raise GateFailed('unsupported_decoding_action')
    if events is not None:
        raise GateFailed('incomplete_transaction_no_ack')
    return result


def framed_roundtrip(records, frame_bytes=49152, maximum_record_bytes=8 * 1024 * 1024):
    """Simulate bounded byte transport; never claim this is a source API test.

    UTF-8 decoding happens after reassembly, so a frame can split a character.
    Returns exact text records and aggregate evidence, never logs row payloads.
    """
    restored, frames, total = [], 0, 0
    for raw in records:
        data = raw.encode('utf-8')
        if not 0 < len(data) <= maximum_record_bytes or frame_bytes <= 0:
            raise GateFailed('fixture_transport_record_limit')
        pieces = [data[i:i + frame_bytes] for i in range(0, len(data), frame_bytes)]
        combined = b''.join(pieces)
        if len(combined) != len(data) or hashlib.sha256(combined).digest() != hashlib.sha256(data).digest():
            raise GateFailed('fixture_frame_integrity')
        restored.append(combined.decode('utf-8'))
        frames += len(pieces)
        total += len(data)
    return restored, dict(records=len(restored), frames=frames, raw_bytes=total)
