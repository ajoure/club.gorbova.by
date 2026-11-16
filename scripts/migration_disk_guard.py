"""Read-only disk checks for an isolated, empty migration target.

Physical telemetry can lag. An independent database connection additionally
counts database growth and ALL WAL generated since the pre-restore sample.
WAL recycling never reduces that conservative estimate. No resize API exists.
"""
import base64
import datetime as dt
import json
import re
import subprocess
import time
import urllib.request

from auth_restore_dryrun import TARGET, GateFailed


class DiskGuard:
    def __init__(self, initial):
        result = subprocess.run(['security', 'find-generic-password', '-s',
                                 'Supabase CLI', '-w'], capture_output=True, text=True)
        if result.returncode:
            raise GateFailed('disk_api_keychain_unavailable')
        self.token = result.stdout.strip()
        if self.token.startswith('go-keyring-base64:'):
            self.token = base64.b64decode(self.token.split(':', 1)[1]).decode()
        self.initial_fs = initial['filesystem']['fs_size_bytes']
        self.scratch_reserve = initial['source_app_auth_index_bytes']
        self.baseline_reserve = 64 * 1024 * 1024
        self.last_request = self.last_check = self.last_remote = 0.0
        self.maximum_fraction = self.maximum_accounted_fraction = 0.0
        self.checks = self.accounting_checks = self.freshness_waits = 0
        self.freshness_wait_seconds = 0.0
        self.remote_loaded = False
        self.monitor = None
        if self.get('')['attributes']['size_gb'] != 8:
            raise GateFailed('unexpected_disk_allocation')
        self.check(force=True)
        self.initial_used = self.physical_used

    def get(self, suffix, timeout=20):
        time.sleep(max(0, 0.60 - (time.monotonic() - self.last_request)))
        request = urllib.request.Request(
            'https://api.supabase.com/v1/projects/' + TARGET + '/config/disk' + suffix,
            headers={'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                result = json.load(response)
        except Exception:
            raise GateFailed('disk_metric_unavailable') from None
        self.last_request = time.monotonic()
        return result

    def refresh(self):
        deadline = time.monotonic() + 90
        waited = False
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GateFailed('disk_metric_freshness_timeout')
            measurement = self.get('/util', timeout=min(20, remaining))
            timestamp = dt.datetime.fromisoformat(measurement['timestamp'].replace('Z', '+00:00'))
            age = (dt.datetime.now(dt.timezone.utc) - timestamp).total_seconds()
            metrics = measurement['metrics']
            size, used = metrics['fs_size_bytes'], metrics['fs_used_bytes']
            if size != self.initial_fs or not 0 <= used <= size or size <= 0:
                raise GateFailed('invalid_metric_or_disk_resize')
            fraction = used / size
            self.maximum_fraction = max(self.maximum_fraction, fraction)
            if fraction >= 0.70:
                raise GateFailed('disk_budget_threshold')
            if age < -5:
                raise GateFailed('future_disk_metric')
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise GateFailed('disk_metric_freshness_timeout')
            # Empirical disk-util snapshots were ~5 minutes apart. This is
            # NOT real-time telemetry: local accounting below covers our writes.
            if age <= 360:
                self.physical_used = used
                self.last_remote = time.monotonic()
                self.remote_loaded = True
                return
            if not waited:
                self.freshness_waits += 1
                waited = True
            started = time.monotonic()
            time.sleep(min(15, remaining))
            self.freshness_wait_seconds += time.monotonic() - started

    @staticmethod
    def lsn_bytes(value):
        if not re.fullmatch(r'[0-9A-F]{1,8}/[0-9A-F]{1,8}', value):
            raise GateFailed('invalid_wal_position')
        high, low = value.split('/')
        return (int(high, 16) << 32) + int(low, 16)

    def sample_database(self):
        # Separate connection: the restore connection can be inside COPY.
        try:
            with self.monitor.cursor() as cur:
                cur.execute('BEGIN READ ONLY')
                cur.execute('SET LOCAL ROLE postgres')
                cur.execute("SET LOCAL statement_timeout='15s'")
                cur.execute("SET LOCAL lock_timeout='5s'")
                cur.execute("SELECT pg_database_size(current_database()),pg_current_wal_insert_lsn()::text,pg_size_bytes(current_setting('shared_buffers'))")
                size, lsn, buffers = cur.fetchone()
                if buffers <= 0:
                    raise GateFailed('invalid_shared_buffer_reserve')
                self.shared_buffer_reserve = buffers
                return size, self.lsn_bytes(lsn)
        finally:
            self.monitor.rollback()

    def bind_monitor(self, connect):
        self.monitor = connect()
        self.initial_database, self.initial_wal = self.sample_database()
        self.check(force=True)

    def check(self, force=False):
        if not force and time.monotonic() - self.last_check < 2:
            return
        # At most four physical-telemetry requests per minute. Force requests
        # still do SQL accounting before/after each heavy DDL / 64MiB COPY.
        if not self.remote_loaded or time.monotonic() - self.last_remote >= 15:
            self.refresh()
        if self.monitor is not None:
            size, wal = self.sample_database()
            if wal < self.initial_wal:
                raise GateFailed('wal_position_reversed')
            estimate = (self.initial_used + max(0, size - self.initial_database)
                        + wal - self.initial_wal + self.scratch_reserve + self.baseline_reserve
                        + self.shared_buffer_reserve)
            fraction = estimate / self.initial_fs
            self.maximum_accounted_fraction = max(self.maximum_accounted_fraction, fraction)
            self.accounting_checks += 1
            if fraction >= 0.70:
                raise GateFailed('accounted_disk_budget_threshold')
        self.last_check = time.monotonic()
        self.checks += 1

    def close(self):
        if self.monitor is not None:
            self.monitor.close()
