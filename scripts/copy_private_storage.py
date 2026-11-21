#!/usr/bin/env python3
"""Copy private Storage objects into the copy via the temporary source bridge.

For each manifest object the copy project issues a signed *upload* URL for the
same bucket/path (service key from the logged-in Supabase CLI, memory only).
The temporary source function copy-private-storage-bridge streams the object
into that URL. Nothing is written to the source. Resumable via a JSONL journal.
Final verification is a separate SQL comparison of target metadata (size and
MD5 eTag) with the manifest.
"""
import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from copy_storage_transfer import TARGET, SOURCE, target_service_key

BRIDGE = f'https://{SOURCE}.supabase.co/functions/v1/copy-private-storage-bridge'
MAX_ITEMS = 10
MAX_BATCH_BYTES = 120 * 1024 * 1024


def signed_upload_url(item, key):
    path = urllib.parse.quote(item['n'], safe='/')
    request = urllib.request.Request(
        f'https://{TARGET}.supabase.co/storage/v1/object/upload/sign/{urllib.parse.quote(item["b"])}/{path}',
        data=b'{}', method='POST',
        headers={'Authorization': 'Bearer ' + key, 'apikey': key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            relative = json.loads(response.read())['url']
    except urllib.error.HTTPError as exc:
        text = exc.read(300).decode('utf-8', 'replace').lower()
        if 'exists' in text:
            return 'exists'
        raise RuntimeError(f'sign_http_{exc.code}') from None
    return f'https://{TARGET}.supabase.co/storage/v1' + relative


def batches(items):
    batch, size = [], 0
    for item in items:
        if batch and (len(batch) == MAX_ITEMS or size + item['s'] > MAX_BATCH_BYTES):
            yield batch
            batch, size = [], 0
        batch.append(item)
        size += item['s']
    if batch:
        yield batch


def call_bridge(payload):
    request = urllib.request.Request(BRIDGE, data=json.dumps(dict(items=payload)).encode(), method='POST',
                                     headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=900) as response:
        return json.loads(response.read())['results']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--journal', type=Path, required=True)
    parser.add_argument('--bucket', action='append', required=True)
    parser.add_argument('--limit', type=int)
    args = parser.parse_args()
    done = set()
    if args.journal.exists():
        for line in args.journal.read_text().splitlines():
            entry = json.loads(line)
            if entry['status'] in ('copied', 'exists'):
                done.add((entry['b'], entry['n']))
    items = [x for x in json.loads(args.manifest.read_text())
             if x['b'] in args.bucket and (x['b'], x['n']) not in done]
    if args.limit:
        items = items[:args.limit]
    key = target_service_key()
    totals = {}
    with args.journal.open('a') as journal:
        def record(item, status, **extra):
            journal.write(json.dumps(dict(b=item['b'], n=item['n'], s=item['s'], status=status, **extra)) + '\n')
            journal.flush()
            totals[status] = totals.get(status, 0) + 1
        for batch in batches(items):
            payload, sent = [], []
            for item in batch:
                try:
                    url = signed_upload_url(item, key)
                except RuntimeError as exc:
                    record(item, 'error', error=str(exc))
                    continue
                if url == 'exists':
                    record(item, 'exists')
                    continue
                payload.append(dict(bucket=item['b'], name=item['n'], upload_url=url, content_type=item.get('m')))
                sent.append(item)
            if not payload:
                continue
            try:
                results = call_bridge(payload)
            except Exception as exc:
                for item in sent:
                    record(item, 'uncertain', error=type(exc).__name__)
                continue
            for item, result in zip(sent, results):
                if result.get('ok'):
                    record(item, 'copied', bytes=result.get('bytes'))
                else:
                    record(item, 'error', error=result.get('error'))
    print(json.dumps(dict(attempted=len(items), skipped=len(done), totals=totals)))


if __name__ == '__main__':
    main()
