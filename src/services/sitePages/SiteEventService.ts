/**
 * Backward-compatible re-export from shared infrastructure module.
 * New code should import from "@/lib/domain-events" directly.
 */
export { DomainEventService as SiteEventService } from "@/lib/domain-events";
export type { DomainEvent, DomainExecution } from "@/lib/domain-events";
