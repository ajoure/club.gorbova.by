import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

// Managed single-function deploys copy the function and _shared, not siblings.
// A repository-wide typecheck cannot detect a dependency missing from that copy.
function assertIsolatedBundle(entry: string, shared: string, read: (path: string) => string) {
  const own = dirname(entry);
  const seen = new Set<string>();
  const inside = (file: string, directory: string) => {
    const path = relative(directory, file);
    return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep));
  };
  const visit = (file: string) => {
    if (seen.has(file)) return;
    if (!inside(file, own) && !inside(file, shared)) {
      throw new Error(`Cross-function dependency: ${relative(own, file)}`);
    }
    seen.add(file);
    const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    const follow = (specifier: ts.Expression | undefined) => {
      if (specifier && ts.isStringLiteralLike(specifier) && specifier.text.startsWith(".")) {
        visit(resolve(dirname(file), specifier.text));
      }
    };
    const walk = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) follow(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) follow(node.arguments[0]);
      ts.forEachChild(node, walk);
    };
    walk(source);
  };
  visit(entry);
  return seen;
}

describe("payment managed single-function packages", () => {
  it.each(["bepaid-readonly-pull", "payments-reconcile", "bepaid-queue-cron"])(
    "%s has all transitive local dependencies in its package",
    (name) => {
      const root = resolve("supabase/functions");
      expect(assertIsolatedBundle(resolve(root, name, "index.ts"), resolve(root, "_shared"),
        (path) => readFileSync(path, "utf8")).size).toBeGreaterThan(1);
    },
  );

  it("rejects sibling imports, including through shared modules and dynamic imports", () => {
    for (const statement of [
      'import { x } from "../other/auth.ts";',
      'export { x } from "../other/auth.ts";',
      'await import("../other/auth.ts");',
    ]) {
      const root = resolve("fixture/functions");
      const entry = resolve(root, "worker/index.ts");
      expect(() => assertIsolatedBundle(entry, resolve(root, "_shared"), () => statement))
        .toThrow("Cross-function dependency");
      expect(() => assertIsolatedBundle(entry, resolve(root, "_shared"), (path) =>
        path === entry ? 'import "../_shared/helper.ts";' : statement))
        .toThrow("Cross-function dependency");
    }
  });

  it("allows cycles inside the package and ignores import-looking comments", () => {
    const root = resolve("fixture/functions");
    const entry = resolve(root, "worker/index.ts");
    const files = {
      [entry]: 'import "../_shared/helper.ts"; // import "../other/auth.ts";',
      [resolve(root, "_shared/helper.ts")]: 'export * from "../worker/index.ts";',
    };
    expect(assertIsolatedBundle(entry, resolve(root, "_shared"), (path) => files[path]).size).toBe(2);
  });
});
