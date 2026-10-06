import { createClient } from "npm:@supabase/supabase-js@2";
import { apifyConnection, apifyRun } from "../_shared/instagram-apify.ts";
import {
  fetchInstagramMedia,
  INSTAGRAM_PILOT,
  instagramPostUrl,
} from "../_shared/instagram-monitor.ts";
import {
  base64FromBytes,
  transcribeAndSummarize,
} from "../_shared/transcribe-audio.ts";

import { coverageReason, datasetPage, startWorkspaceRun } from "./provider.ts";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const BUCKET = "instagram-monitor-media";
const client = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
function checked(result: { data: any; error: any }): any {
  if (result.error) throw new Error("database_failed");
  return result.data;
}
const num = (v: unknown) =>
  Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0;
function date(v: unknown): string | null {
  const d = new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
function safeCode(e: unknown): string {
  const msg = e instanceof Error ? e.message : "";
  return /^[a-z][a-z0-9_]{0,64}$/.test(msg) ? msg : "processing_failed";
}
async function finish(
  job: any,
  owner: string,
  status: string,
  error: string | null = null,
  provider: string | null = null,
  cost: number | null = null,
) {
  const ok = checked(
    await client.rpc("instagram_monitor_finish", {
      _id: job.id,
      _owner: owner,
      _status: status,
      _error: error,
      _provider_id: provider,
      _cost: cost,
    }),
  );
  if (!ok) throw new Error("lease_lost");
}
async function markProcessing(job: any, owner: string) {
  const rows = checked(
    await client.from("instagram_monitor_runs").update({ status: "processing" })
      .eq("id", job.id).eq("lease_owner", owner).gt(
        "lease_expires_at",
        new Date().toISOString(),
      ).select("id"),
  );
  if (rows.length !== 1) throw new Error("lease_lost");
}
async function enqueue(
  kind: string,
  profileId: string | null,
  reelId: string | null,
) {
  checked(
    await client.rpc("instagram_monitor_enqueue", {
      _kind: kind,
      _profile_id: profileId,
      _reel_id: reelId,
    }),
  );
}
async function dataset(token: string, runId: string): Promise<any[]> {
  const run = await apifyRun(token, runId);
  if (!["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(run.status)) {
    throw new Error("source_run_not_terminal");
  }
  const items: any[] = [];
  for (let offset = 0;; offset += 50) {
    const page = await datasetPage(token, run.defaultDatasetId, offset);
    items.push(...page);
    if (page.length < 50) return items;
  }
}
async function importReels(job: any, items: any[], token: string) {
  const profile = checked(
    await client.from("instagram_monitor_profiles").select("username").eq(
      "id",
      job.profile_id,
    ).single(),
  );
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (String(item.ownerUsername || "").toLowerCase() !== profile.username) {
      continue;
    }
    const postUrl = instagramPostUrl(item.url);
    const shortcode = postUrl.split("/")[4];
    const values = {
      profile_id: job.profile_id,
      shortcode,
      post_url: postUrl,
      caption: String(item.caption || "").slice(0, 20000),
      published_at: date(item.timestamp),
      likes_count: num(item.likesCount),
      comments_count: num(item.commentsCount),
      duration_seconds: Number(item.videoDuration) || null,
      source_run_id: job.provider_run_id,
    };
    // Keep stored media/transcript; refresh the source of a failed or pending download.
    const existing = checked(
      await client.from("instagram_monitor_reels").select(
        "id,storage_path,source_run_id,profile_id,duration_seconds,comments_checked_at,comments_count",
      ).eq("shortcode", shortcode).maybeSingle(),
    );
    if (existing && existing.profile_id !== job.profile_id) continue;
    let reel: any;
    if (existing) {
      checked(
        await client.from("instagram_monitor_reels").update({
          likes_count: values.likes_count,
          comments_count: values.comments_count,
          caption: values.caption,
          ...(!existing.storage_path
            ? {
              source_run_id: job.provider_run_id,
              duration_seconds: values.duration_seconds ??
                existing.duration_seconds,
            }
            : {}),
        }).eq("id", existing.id),
      );
      reel = existing;
    } else {reel = checked(
        await client.from("instagram_monitor_reels").insert(values).select(
          "id,storage_path",
        ).single(),
      );}
    if (!reel.storage_path) await enqueue("media", job.profile_id, reel.id);
    const count = checked(
      await client.from("instagram_monitor_runs").select("id").eq(
        "kind",
        "comments",
      ).eq("reel_id", reel.id).limit(1),
    );
    if (
      !count.length || (existing &&
        (!existing.comments_checked_at ||
          Date.parse(existing.comments_checked_at) < Date.now() - 86400000 ||
          values.comments_count > existing.comments_count))
    ) {
      await enqueue("comments", job.profile_id, reel.id);
    }
  }
  checked(
    await client.from("instagram_monitor_profiles").update({
      last_checked_at: new Date().toISOString(),
    }).eq("id", job.profile_id),
  );
}
async function importComments(
  job: any,
  items: any[],
  run: any,
  complete: boolean,
) {
  const reel = checked(
    await client.from("instagram_monitor_reels").select(
      "post_url,comments_count",
    ).eq(
      "id",
      job.reel_id,
    ).single(),
  );
  const rows = items.filter((x) =>
    x && x.id && typeof x.text === "string" &&
    (!x.postUrl || instagramPostUrl(x.postUrl) === reel.post_url)
  ).map((x) => ({
    reel_id: job.reel_id,
    provider_comment_id: String(x.id).slice(0, 128),
    username: String(x.ownerUsername || x.owner?.username || "").slice(0, 100),
    text: x.text.slice(0, 20000),
    posted_at: date(x.timestamp),
    parent_comment_id: x.parentCommentId
      ? String(x.parentCommentId).slice(0, 128)
      : null,
    likes_count: num(x.likesCount),
  }));
  if (rows.length) {
    checked(
      await client.from("instagram_monitor_comments").upsert(rows, {
        onConflict: "reel_id,provider_comment_id",
        ignoreDuplicates: false,
      }),
    );
  }
  const response = await client.from("instagram_monitor_comments").select(
    "id",
    { count: "exact", head: true },
  ).eq("reel_id", job.reel_id);
  checked(response);
  checked(
    await client.from("instagram_monitor_reels").update({
      collected_comments_count: response.count || 0,
      comments_coverage: complete &&
          coverageReason(
              run,
              response.count || 0,
              reel.comments_count,
              job.request_options?.include_replies === true,
            ) === "provider_finished"
        ? "available"
        : "partial",
      comments_checked_at: new Date().toISOString(),
      coverage_reason: complete
        ? coverageReason(
          run,
          response.count || 0,
          reel.comments_count,
          job.request_options?.include_replies === true,
        )
        : "importing",
    }).eq("id", job.reel_id),
  );
}
async function processJob(job: any, owner: string) {
  if (["reels", "comments"].includes(job.kind)) {
    const connection = await apifyConnection(client);
    const token = connection.token;
    if (job.status === "queued" && !connection.enabled) {
      await finish(job, owner, "queued", "monitor_disabled");
      return;
    }
    if (!token) {
      await finish(job, owner, "failed", "missing_apify_token");
      return;
    }
    if (job.status === "queued") {
      const source = job.kind === "reels"
        ? checked(
          await client.from("instagram_monitor_profiles").select("username").eq(
            "id",
            job.profile_id,
          ).single(),
        ).username
        : checked(
          await client.from("instagram_monitor_reels").select("post_url").eq(
            "id",
            job.reel_id,
          ).single(),
        ).post_url;
      const reserved = checked(
        await client.rpc("instagram_monitor_reserve", {
          _id: job.id,
          _owner: owner,
        }),
      );
      if (!reserved) {
        // Reserve may have finished a budget-exhausted job itself.
        const current = checked(
          await client.from("instagram_monitor_runs").select("status").eq(
            "id",
            job.id,
          ).single(),
        );
        if (current.status === "queued") await finish(job, owner, "queued");
        return;
      }
      try {
        const options = checked(
          await client.from("instagram_monitor_settings").select(
            "reels_per_run,run_timeout_seconds,include_replies,max_run_usd",
          ).single(),
        );
        const updated = checked(
          await client.from("instagram_monitor_runs").update({
            request_options: options,
          }).eq("id", job.id).eq("lease_owner", owner).gt(
            "lease_expires_at",
            new Date().toISOString(),
          ).select("id"),
        );
        if (updated.length !== 1) throw new Error("lease_lost");
        const runId = await startWorkspaceRun(token, job.kind, source, options);
        await finish(job, owner, "waiting", null, runId);
      } catch (e) {
        const code = safeCode(e);
        // Explicit authentication/input refusals did not accept a run. Network
        // errors, timeouts and server failures retain the reservation as UNKNOWN.
        const rejected = /^apify_http_(400|401|403|404|422)$/.test(code);
        await finish(
          job,
          owner,
          rejected ? "failed" : "unknown",
          code,
          null,
          rejected ? 0 : null,
        );
      }
      return;
    }
    const run = await apifyRun(token, job.provider_run_id);
    if (!["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"].includes(run.status)) {
      await finish(job, owner, "waiting");
      return;
    }
    // No second start: all subsequent retries poll/import the SAME provider run.
    const cost = typeof run.usageTotalUsd === "number" && run.usageTotalUsd >= 0
      ? run.usageTotalUsd
      : null;
    if (!run.defaultDatasetId) {
      await finish(
        job,
        owner,
        "failed",
        "provider_dataset_missing",
        null,
        cost,
      );
      return;
    }
    const offset = Number(job.import_offset || 0);
    const items = await datasetPage(token, run.defaultDatasetId, offset);
    const complete = items.length < 50;
    if (job.kind === "reels") await importReels(job, items, token);
    else await importComments(job, items, run, complete);
    const progress = checked(
      await client.from("instagram_monitor_runs").update({
        import_offset: offset + items.length,
      }).eq("id", job.id).eq("lease_owner", owner).gt(
        "lease_expires_at",
        new Date().toISOString(),
      ).select("id"),
    );
    if (progress.length !== 1) throw new Error("lease_lost");
    if (!complete) {
      await finish(job, owner, "waiting", null, null, cost);
      return;
    }
    await finish(
      job,
      owner,
      items.length || offset || job.kind === "comments"
        ? "succeeded"
        : "failed",
      items.length || offset || job.kind === "comments"
        ? null
        : "provider_empty_result",
      null,
      cost,
    );
    return;
  }
  if (!(await apifyConnection(client)).enabled) {
    await finish(job, owner, "queued", "monitor_disabled");
    return;
  }
  await markProcessing(job, owner);
  const reel = checked(
    await client.from("instagram_monitor_reels").select("*").eq(
      "id",
      job.reel_id,
    ).single(),
  );
  if (job.kind === "media") {
    if (!reel.storage_path) {
      if (
        !reel.duration_seconds ||
        reel.duration_seconds > INSTAGRAM_PILOT.maxDurationSeconds
      ) throw new Error("duration_not_supported");
      const token = (await apifyConnection(client)).token;
      if (!token) throw new Error("missing_apify_token");
      const items = await dataset(token, reel.source_run_id);
      const item = items.find((x) =>
        x.shortCode === reel.shortcode || x.shortcode === reel.shortcode ||
        x.url && instagramPostUrl(x.url) === reel.post_url
      );
      const mediaUrl = item?.downloadedVideo || item?.videoUrl;
      if (typeof mediaUrl !== "string") {
        throw new Error("provider_video_missing");
      }
      const media = await fetchInstagramMedia(mediaUrl);
      const path = `${reel.id}/video.mp4`;
      checked(
        await client.storage.from(BUCKET).upload(path, media.bytes, {
          contentType: "video/mp4",
          upsert: true,
        }),
      );
      checked(
        await client.from("instagram_monitor_reels").update({
          storage_path: path,
        }).eq("id", reel.id),
      );
    }
    const prior = checked(
      await client.from("instagram_monitor_runs").select("id").eq(
        "kind",
        "transcribe",
      ).eq("reel_id", reel.id).limit(1),
    );
    if (!prior.length) await enqueue("transcribe", reel.profile_id, reel.id);
  } else if (job.kind === "transcribe") {
    if (!reel.storage_path) throw new Error("video_missing");
    if (reel.transcript_status !== "done") {
      const apiKey = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKey) throw new Error("missing_ai_key");
      checked(
        await client.from("instagram_monitor_reels").update({
          transcript_status: "processing",
        }).eq("id", reel.id),
      );
      const blob = checked(
        await client.storage.from(BUCKET).download(reel.storage_path),
      );
      if (blob.size > INSTAGRAM_PILOT.maxMediaBytes || blob.size < 4096) {
        throw new Error("media_not_supported");
      }
      const output = await transcribeAndSummarize({
        apiKey,
        base64: base64FromBytes(new Uint8Array(await blob.arrayBuffer())),
        format: "mp4",
        kind: "reel",
        timeoutMs: 60_000,
      });
      if (output.transcript.length < 10) throw new Error("transcript_empty");
      checked(
        await client.from("instagram_monitor_reels").update({
          ...output,
          transcript_status: "done",
        }).eq("id", reel.id),
      );
    }
  }
  await finish(job, owner, "succeeded");
}
async function autoQueue() {
  checked(
    await client.rpc("instagram_monitor_queue_profiles", { _force: false }),
  );
}
async function tick() {
  let job: any;
  const owner = crypto.randomUUID();
  try {
    await autoQueue();
    const jobs = checked(
      await client.rpc("instagram_monitor_claim", { _owner: owner }),
    );
    job = jobs[0];
    if (job) await processJob(job, owner);
  } catch (e) {
    const code = safeCode(e);
    if (job) {
      try {
        const status = job.status === "waiting" && job.attempts < 20
          ? "waiting"
          : job.kind === "media" && job.attempts < 3
          ? "queued"
          : "failed";
        if (job.kind === "transcribe") {
          checked(
            await client.from("instagram_monitor_reels").update({
              transcript_status: "failed",
            }).eq("id", job.reel_id),
          );
        }
        await finish(job, owner, status, code);
      } catch { /* Lease recovery owns interrupted jobs. */ }
    }
    console.warn("[instagram-monitor-worker]", { code });
  }
}
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method_not_allowed", { status: 405 });
  }
  const auth = await client.rpc("verify_instagram_monitor_cron_secret", {
    _candidate: req.headers.get("x-instagram-monitor-secret") || "",
  });
  if (auth.error || auth.data !== true) {
    return new Response("unauthorized", { status: 401 });
  }
  // pg_net can finish its HTTP request while the bounded job continues.
  // Durable leases recover a worker terminated by the platform wall-clock limit.
  EdgeRuntime.waitUntil(tick());
  return Response.json({ accepted: true }, { status: 202 });
});
