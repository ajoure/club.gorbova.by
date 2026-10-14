import { describe, expect, it, vi } from "vitest";
import { BroadcastSmtpError, processManualEmailBatch, type ManualEmailJob } from "../../supabase/functions/email-mass-broadcast/manualEmailQueue";

const jobs: ManualEmailJob[] = Array.from({ length: 10 }, (_, index) => ({ delivery_id: String(index), account_id: "account", recipient: "test@example.invalid", subject: "test", html: "<p>test</p>", attempts: 1 }));
const dependencies = () => ({ now: () => 0, send: vi.fn().mockResolvedValue(undefined), accepted: vi.fn().mockResolvedValue(undefined), settle: vi.fn().mockResolvedValue(undefined), cooldown: vi.fn().mockResolvedValue(undefined) });

describe("durable manual email batches", () => {
  it("persists every acceptance before sending the next recipient", async () => {
    const deps = dependencies();
    const order: string[] = [];
    deps.send.mockImplementation(async (job) => { order.push(`send:${job.delivery_id}`); });
    deps.accepted.mockImplementation(async (job) => { order.push(`accepted:${job.delivery_id}`); });
    expect(await processManualEmailBatch(jobs, deps)).toEqual({ accepted: 10, failed: 0, deferred: 0 });
    expect(order.slice(0, 4)).toEqual(["send:0", "accepted:0", "send:1", "accepted:1"]);
  });

  it("SMTP 450 stops the batch and delays only unsent jobs for 15 minutes", async () => {
    const deps = dependencies();
    deps.send.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new BroadcastSmtpError(450, false));
    expect(await processManualEmailBatch(jobs, deps)).toEqual({ accepted: 2, failed: 0, deferred: 8 });
    expect(deps.send).toHaveBeenCalledTimes(3);
    expect(deps.cooldown).toHaveBeenCalledWith("1970-01-01T00:15:00.000Z");
    expect(deps.settle.mock.calls.filter((call) => call[1] === "queued").map((call) => call[0].delivery_id)).toEqual(["2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("never retries an uncertain SMTP outcome or overwrites it as accepted", async () => {
    const deps = dependencies();
    deps.send.mockRejectedValueOnce(new BroadcastSmtpError(0, true));
    await processManualEmailBatch(jobs.slice(0, 1), deps);
    expect(deps.settle).toHaveBeenCalledWith(jobs[0], "uncertain", "smtp_outcome_unknown");
    expect(deps.accepted).not.toHaveBeenCalled();
    expect(deps.cooldown).not.toHaveBeenCalled();
  });

  it("stops on an acceptance-journal failure without retrying or sending more", async () => {
    const deps = dependencies();
    deps.accepted.mockRejectedValueOnce(new Error("journal unavailable"));
    await expect(processManualEmailBatch(jobs, deps)).rejects.toThrow("journal unavailable");
    expect(deps.send).toHaveBeenCalledTimes(1);
    expect(deps.settle).not.toHaveBeenCalled();
  });

  it("returns untouched jobs to the queue before the worker wall time expires", async () => {
    const deps = dependencies();
    let now = 0;
    deps.now = () => now;
    deps.send.mockImplementation(async () => { now += 31_000; });
    expect(await processManualEmailBatch(jobs, deps)).toEqual({ accepted: 2, failed: 0, deferred: 8 });
    expect(deps.send).toHaveBeenCalledTimes(2);
  });
});
