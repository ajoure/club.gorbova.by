import { apifyRequest, providerId } from "../_shared/instagram-apify.ts";

export interface WorkspaceOptions {
  reels_per_run: number;
  run_timeout_seconds: number;
  include_replies: boolean;
  max_run_usd: number;
}
export function workspaceInput(
  kind: string,
  source: string,
  options: WorkspaceOptions,
) {
  return kind === "reels"
    ? {
      username: [source],
      resultsLimit: options.reels_per_run,
      includeDownloadedVideo: true,
      includeTranscript: false,
      skipPinnedPosts: true,
    }
    : {
      directUrls: [source],
      resultsLimit: 2147483647,
      includeNestedComments: options.include_replies,
    };
}
export async function startWorkspaceRun(
  token: string,
  kind: string,
  source: string,
  options: WorkspaceOptions,
) {
  if (
    !Number.isFinite(options.max_run_usd) || options.max_run_usd <= 0 ||
    options.max_run_usd > 0.25 ||
    !Number.isInteger(options.reels_per_run) || options.reels_per_run < 1 ||
    options.reels_per_run > 100 ||
    !Number.isInteger(options.run_timeout_seconds) ||
    options.run_timeout_seconds < 60 || options.run_timeout_seconds > 600 ||
    typeof options.include_replies !== "boolean"
  ) throw new Error("invalid_provider_options");
  const actor = kind === "reels"
    ? "apify~instagram-reel-scraper"
    : "apify~instagram-comment-scraper";
  const result = await apifyRequest(
    token,
    `acts/${actor}/runs?maxTotalChargeUsd=${options.max_run_usd}&timeout=${options.run_timeout_seconds}&memory=1024`,
    workspaceInput(kind, source, options),
  );
  return providerId(result?.data?.id);
}
export async function datasetPage(
  token: string,
  dataset: string,
  offset: number,
) {
  const items = await apifyRequest(
    token,
    `datasets/${
      providerId(dataset)
    }/items?clean=false&offset=${offset}&limit=50&desc=false`,
  );
  if (!Array.isArray(items)) throw new Error("invalid_provider_dataset");
  return items;
}
export function coverageReason(
  run: any,
  count: number,
  expected: number,
  replies: boolean,
) {
  if (run.status === "TIMED-OUT") return "timeout";
  if (run.status !== "SUCCEEDED") return "provider_stopped";
  if (/charg|budget|limit/i.test(String(run.statusMessage || ""))) {
    return "budget_limited";
  }
  if (count < expected) {
    return replies ? "instagram_inaccessible" : "replies_not_requested";
  }
  return "provider_finished";
}
