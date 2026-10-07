// Check the actual Cloud packaging boundary, not the full repository layout.
// A sibling function exists in Git but is absent from a deployed package.
import { mkdtemp, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
for (const name of ['gorbova-ai-chat', 'mns-response-generator']) {
  const isolated = await mkdtemp(join(tmpdir(), 'mns-cloud-bundle-'));
  try {
    const functions = join(isolated, 'functions');
    await mkdir(functions);
    await cp(join(root, 'supabase/functions/_shared'), join(functions, '_shared'), { recursive: true });
    await cp(join(root, 'supabase/functions', name), join(functions, name), { recursive: true });
    const result = spawnSync('deno', ['check', '--no-lock', join(functions, name, 'index.ts')], { cwd: isolated, stdio: 'inherit' });
    if (result.error || result.status !== 0) throw new Error(`Cloud package does not compile: ${name}`, { cause: result.error });
    console.log(`Cloud package PASS: ${name}`);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}
