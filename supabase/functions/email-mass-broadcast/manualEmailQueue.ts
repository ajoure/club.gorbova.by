export interface ManualEmailJob {
  delivery_id: string;
  account_id: string;
  recipient: string;
  subject: string;
  html: string;
  attempts: number;
}

export class BroadcastSmtpError extends Error {
  constructor(public code: number, public ambiguous: boolean) {
    super(ambiguous ? "smtp_outcome_unknown" : `smtp_rejected_${code}`);
  }
}

export interface QueueDependencies {
  now: () => number;
  send: (job: ManualEmailJob) => Promise<void>;
  accepted: (job: ManualEmailJob) => Promise<void>;
  settle: (job: ManualEmailJob, status: "accepted" | "failed" | "uncertain" | "queued", errorCode?: string, nextAttemptAt?: string) => Promise<void>;
  cooldown: (until: string) => Promise<void>;
}

/** Each SMTP acceptance is persisted before the next recipient. Ambiguous
 * outcomes and journal failures never get an automatic send retry. */
export async function processManualEmailBatch(jobs: ManualEmailJob[], deps: QueueDependencies) {
  const started = deps.now();
  let accepted = 0;
  let failed = 0;
  let deferred = 0;
  for (let index = 0; index < jobs.length; index++) {
    const job = jobs[index];
    if (deps.now() - started > 60_000) {
      for (const remaining of jobs.slice(index)) {
        await deps.settle(remaining, "queued");
        deferred++;
      }
      break;
    }
    try {
      await deps.send(job);
    } catch (error) {
      // A definite 4xx SMTP rejection is safe to retry after a cooldown.
      if (error instanceof BroadcastSmtpError && !error.ambiguous && (error.code === 0 || (error.code >= 400 && error.code < 500)) && job.attempts < 8) {
        const retryAt = new Date(deps.now() + 15 * 60_000).toISOString();
        await deps.cooldown(retryAt);
        for (const remaining of jobs.slice(index)) {
          await deps.settle(remaining, "queued", `smtp_temporary_${error.code}`, retryAt);
          deferred++;
        }
        break;
      }
      const ambiguous = !(error instanceof BroadcastSmtpError) || error.ambiguous;
      await deps.settle(job, ambiguous ? "uncertain" : "failed", ambiguous ? "smtp_outcome_unknown" : `smtp_rejected_${error.code}`);
      failed++;
      continue;
    }
    // Do not catch journal errors as SMTP errors or mark an accepted mail failed.
    // If persistence fails, leave processing locked for operator reconciliation.
    try {
      await deps.accepted(job);
      await deps.settle(job, "accepted");
    } catch (error) {
      // Only this attempted recipient has an uncertain outcome. The rest of
      // the claimed batch was never sent and can safely wait for another tick.
      for (const remaining of jobs.slice(index + 1)) await deps.settle(remaining, "queued");
      throw error;
    }
    accepted++;
  }
  return { accepted, failed, deferred };
}
