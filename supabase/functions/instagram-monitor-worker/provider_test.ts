import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  coverageReason,
  datasetPage,
  startWorkspaceRun,
  workspaceInput,
} from "./provider.ts";
const options = {
  reels_per_run: 10,
  run_timeout_seconds: 180,
  include_replies: false,
  max_run_usd: 0.25,
};
Deno.test("full comments request keeps paid replies opt-in and budget fenced", async () => {
  assertEquals(
    workspaceInput("comments", "https://www.instagram.com/p/example/", options),
    {
      directUrls: ["https://www.instagram.com/p/example/"],
      resultsLimit: 2147483647,
      includeNestedComments: false,
    },
  );
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const u = new URL(String(input));
    assertEquals(u.searchParams.get("maxTotalChargeUsd"), "0.25");
    assertEquals(u.searchParams.has("token"), false);
    assertEquals(JSON.parse(String(init?.body)).includeNestedComments, false);
    return Promise.resolve(Response.json({ data: { id: "fixtureRun" } }));
  };
  try {
    assertEquals(
      await startWorkspaceRun(
        "fixture-only",
        "comments",
        "https://www.instagram.com/p/example/",
        options,
      ),
      "fixtureRun",
    );
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("dataset pagination passes durable offset, not the first page again", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (input) => {
    const u = new URL(String(input));
    assertEquals(u.searchParams.get("offset"), "1500");
    assertEquals(u.searchParams.get("limit"), "50");
    return Promise.resolve(Response.json([{ id: "last" }]));
  };
  try {
    assertEquals(await datasetPage("fixture-only", "fixtureDataset", 1500), [{
      id: "last",
    }]);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("provider completeness never hides budget, timeout or count mismatch", () => {
  assertEquals(
    coverageReason({ status: "TIMED-OUT" }, 500, 500, true),
    "timeout",
  );
  assertEquals(
    coverageReason(
      { status: "SUCCEEDED", statusMessage: "Maximum total charge reached" },
      500,
      500,
      true,
    ),
    "budget_limited",
  );
  assertEquals(
    coverageReason({ status: "SUCCEEDED" }, 6, 11, false),
    "replies_not_requested",
  );
  assertEquals(
    coverageReason({ status: "SUCCEEDED" }, 11, 11, true),
    "provider_finished",
  );
});

Deno.test("invalid provider settings cannot remove the price guard", async () => {
  const { assertRejects } = await import(
    "https://deno.land/std@0.224.0/assert/mod.ts"
  );
  await assertRejects(
    () =>
      startWorkspaceRun(
        "fixture-only",
        "comments",
        "https://www.instagram.com/p/example/",
        { ...options, max_run_usd: 0 },
      ),
    Error,
    "invalid_provider_options",
  );
  await assertRejects(
    () =>
      startWorkspaceRun(
        "fixture-only",
        "comments",
        "https://www.instagram.com/p/example/",
        { ...options, max_run_usd: 5 },
      ),
    Error,
    "invalid_provider_options",
  );
});

Deno.test("coauthors are accepted but unrelated and missing owners are excluded", async () => {
  const { belongsToProfile, withinRunWindow } = await import("./provider.ts");
  assertEquals(
    belongsToProfile({
      ownerUsername: "expert",
      coauthors: [{ username: "TARGET" }],
    }, "target"),
    true,
  );
  assertEquals(
    belongsToProfile({ owner: { username: "target" } }, "target"),
    true,
  );
  assertEquals(
    belongsToProfile({ coauthorProducers: [{ username: "target" }] }, "target"),
    true,
  );
  assertEquals(belongsToProfile({ ownerUsername: "other" }, "target"), false);
  assertEquals(belongsToProfile({}, "target"), false);
  const window = {
    ...options,
    window_start: "2026-10-05T21:00:00Z",
    window_end: "2026-10-06T21:00:00Z",
  };
  assertEquals(
    withinRunWindow({ timestamp: window.window_start }, window),
    true,
  );
  assertEquals(
    withinRunWindow({ timestamp: window.window_end }, window),
    false,
  );
  assertEquals(withinRunWindow({ timestamp: "invalid" }, window), false);
  assertEquals(
    (workspaceInput("reels", "target", window) as { onlyPostsNewerThan?: string }).onlyPostsNewerThan,
    window.window_start,
  );
});
