import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { vi } from 'vitest';
export function load(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  return loadText(readFileSync(path, 'utf8'), modules, globals);
}

export function loadText(source: string, modules: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let handler: (req: Request) => Promise<Response>;
  const effects = vi.fn(() => { throw Error('unexpected external effect'); });
  const exports = {};
  runInNewContext(compiled, { exports, require: (name: string) => modules[name] || new Proxy({}, { get: () => effects }),
    Deno: { serve: (h: typeof handler) => { handler = h; }, env: { get: () => 'synthetic-not-secret' } },
    console: { log: () => {}, error: () => {}, warn: () => {} }, Response, Request, fetch: effects, URL, crypto, setTimeout, ...globals });
  return { exports: exports as any, handler: (req: Request) => handler(req), effects };
}

