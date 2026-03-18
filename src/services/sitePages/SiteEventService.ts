import { supabase } from "@/integrations/supabase/client";

export interface DomainEvent {
  id: string;
  event_type: string;
  source: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface DomainExecution {
  id: string;
  event_id: string;
  step: string;
  status: "pending" | "success" | "failed" | "retrying";
  error: string | null;
  attempt: number;
  created_at: string;
}

/**
 * SiteEventService — platform infrastructure for domain events.
 * All business logic emits events here; events are processed synchronously in MVP.
 */
export class SiteEventService {
  static async emitEvent(
    eventType: string,
    source: string,
    entityId: string,
    payload: Record<string, unknown>
  ): Promise<string> {
    const { data, error } = await (supabase
      .from("domain_events") as any)
      .insert({
        event_type: eventType,
        source,
        entity_id: entityId,
        payload,
      })
      .select("id")
      .single();

    if (error) throw new Error(`Failed to emit event: ${error.message}`);
    return data.id;
  }

  static async recordExecution(
    eventId: string,
    step: string,
    status: "pending" | "success" | "failed",
    error?: string
  ): Promise<string> {
    const { data, error: dbError } = await (supabase
      .from("domain_executions") as any)
      .insert({
        event_id: eventId,
        step,
        status,
        error: error || null,
        attempt: 1,
      })
      .select("id")
      .single();

    if (dbError) throw new Error(`Failed to record execution: ${dbError.message}`);
    return data.id;
  }

  static async updateExecution(
    executionId: string,
    status: "success" | "failed" | "retrying",
    error?: string
  ): Promise<void> {
    const { error: dbError } = await (supabase
      .from("domain_executions") as any)
      .update({ status, error: error || null })
      .eq("id", executionId);

    if (dbError) throw new Error(`Failed to update execution: ${dbError.message}`);
  }
}
