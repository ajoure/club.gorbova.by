#!/usr/bin/env python3
"""Copy Storage object bytes from the source project into the copy.

Reads a manifest (bucket, name, size, mimetype, eTag, cacheControl) exported
from source storage.objects. Public buckets are read from their public URLs;
nothing is written to the source. Each object is streamed to a temporary file,
checked against the manifest size (and MD5 eTag when the eTag is a plain MD5),
uploaded to our own project with upsert disabled, then the temp file is removed.
A JSONL journal makes the run resumable; already copied objects are skipped.

The target service key is obtained from the logged-in Supabase CLI into process
memory only. It is never printed, logged or passed on a command line.
"""
import argparse
import concurrent.futures
import hashlib
import json
import re
import subprocess
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

SOURCE = 'hdjgkjceownmmnrqqtuz'
TARGET = 'ypwsuumurrtkxatoyqhk'
MD5 = re.compile(r'^"?([0-9a-f]{32})"?$')
lock = threading.Lock()


def target_service_key():
    result = subprocess.run(['supabase', 'projects', 'api-keys', '--project-ref', TARGET, '-o', 'json'],
                            stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise SystemExit('cli_api_keys_failed')
    for item in json.loads(result.stdout):
        if item.get('name') == 'service_role' and item.get('api_key'):
            return item['api_key']
    raise SystemExit('service_role_key_missing')


def object_url(project, bucket, name, public=False):
    path = urllib.parse.quote(name, safe='/')
    kind = 'object/public' if public else 'object'
    return f'https://{project}.supabase.co/storage/v1/{kind}/{urllib.parse.quote(bucket)}/{path}'


def download(item, temp_dir):
    digest, size = hashlib.md5(), 0
    handle = tempfile.NamedTemporaryFile(dir=temp_dir, delete=False)
    try:
        with urllib.request.urlopen(object_url(SOURCE, item['b'], item['n'], public=True), timeout=300) as response:
            while chunk := response.read(1024 * 1024):
                handle.write(chunk)
                digest.update(chunk)
                size += len(chunk)
        handle.close()
    except BaseException:
        handle.close()
        Path(handle.name).unlink(missing_ok=True)
        raise
    return Path(handle.name), size, digest.hexdigest()


def upload(item, path, key):
    headers = {'Authorization': 'Bearer ' + key, 'apikey': key, 'x-upsert': 'false',
               'Content-Type': item.get('m') or 'application/octet-stream',
               'Content-Length': str(path.stat().st_size)}
    if item.get('c'):
        headers['cache-control'] = item['c'] if item['c'].startswith('max-age') else 'max-age=' + item['c']
    with path.open('rb') as body:
        request = urllib.request.Request(object_url(TARGET, item['b'], item['n']), data=body, headers=headers, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=600) as response:
                return response.status
        except urllib.error.HTTPError as exc:
            text = exc.read(300).decode('utf-8', 'replace')
            if exc.code in (400, 409) and 'already exists' in text.lower():
                return 'exists'
            raise RuntimeError(f'upload_http_{exc.code}') from None


def copy_one(item, key, temp_dir):
    path = None
    try:
        path, size, md5 = download(item, temp_dir)
        if size != item['s']:
            return dict(status='size_mismatch', got=size)
        expected = MD5.match(item.get('e') or '')
        if expected and expected[1] != md5:
            return dict(status='md5_mismatch')
        return dict(status='copied', upload=upload(item, path, key), md5=md5, md5_checked=bool(expected))
    except Exception as exc:
        return dict(status='error', error=str(exc)[:200] if isinstance(exc, RuntimeError) else type(exc).__name__)
    finally:
        if path:
            path.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, required=True)
    parser.add_argument('--journal', type=Path, required=True)
    parser.add_argument('--temp-dir', type=Path, required=True)
    parser.add_argument('--bucket', action='append', required=True, help='public source bucket to copy')
    parser.add_argument('--workers', type=int, default=4)
    args = parser.parse_args()
    done = set()
    if args.journal.exists():
        for line in args.journal.read_text().splitlines():
            entry = json.loads(line)
            if entry['status'] == 'copied':
                done.add((entry['b'], entry['n']))
    items = [x for x in json.loads(args.manifest.read_text())
             if x['b'] in args.bucket and (x['b'], x['n']) not in done]
    key = target_service_key()
    totals = {}
    with args.journal.open('a') as journal, concurrent.futures.ThreadPoolExecutor(args.workers) as pool:
        futures = {pool.submit(copy_one, item, key, args.temp_dir): item for item in items}
        for future in concurrent.futures.as_completed(futures):
            item = futures[future]
            result = future.result()
            with lock:
                journal.write(json.dumps(dict(b=item['b'], n=item['n'], s=item['s'], **result)) + '\n')
                journal.flush()
                totals[result['status']] = totals.get(result['status'], 0) + 1
    print(json.dumps(dict(attempted=len(items), skipped_already_copied=len(done), totals=totals)))


if __name__ == '__main__':
    main()
