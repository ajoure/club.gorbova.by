import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/functions-full-audit.yml"),
  "utf8",
);

describe("full Edge Function audit workflow", () => {
  it("keeps OPTIONS probes read-only", () => {
    expect(workflow).toContain("Run safe full audit (OPTIONS only)");
    expect(workflow).not.toContain('-d \'{"ping":true}\'');
  });

  it("separates response headers and bodies from curl diagnostics", () => {
    expect(workflow).toContain('-D "$OPT_HEADERS_FILE"');
    expect(workflow).toContain('-o "$OPT_BODY_FILE"');
    expect(workflow).toContain('2>"$OPT_ERROR_FILE"');
    expect(workflow).not.toContain('echo "$OPT_RAW" | head -n 1');
  });

  it("classifies transport errors from curl exit status, not response content", () => {
    expect(workflow).toContain('if [ "$CURL_EXIT" -ne 0 ]');
    expect(workflow).not.toContain("connection.*failed|timed out|Could not resolve|TLS");
  });

  it("fails closed when any checked-in function disappears from results", () => {
    expect(workflow).toContain('expected_total="$(wc -l < "$LIST"');
    expect(workflow).toContain('actual_total="${#lines[@]}"');
    expect(workflow).toContain('if [ "$actual_total" -ne "$expected_total" ]');
  });
});
