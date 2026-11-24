import assert from 'node:assert/strict';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Match the managed deployment boundary: the selected function plus _shared.
// A source-tree import graph check alone misses imports into peer functions.
const functions = fileURLToPath(new URL('../../supabase/functions/', import.meta.url));
const stage = await mkdtemp(join(tmpdir(), 'sms-managed-package-'));
try {
  await cp(join(functions, 'websms-send'), join(stage, 'websms-send'), { recursive: true });
  await cp(join(functions, '_shared'), join(stage, '_shared'), { recursive: true });
  const result = await build({
    entryPoints: [join(stage, 'websms-send/index.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external: ['https://*'],
    logLevel: 'silent',
  });
  assert.equal(result.errors.length, 0);
  assert.ok(result.outputFiles[0].contents.length > 0);
  console.log('SMS managed function + _shared package bundles: PASS');
} finally {
  await rm(stage, { recursive: true, force: true });
}
