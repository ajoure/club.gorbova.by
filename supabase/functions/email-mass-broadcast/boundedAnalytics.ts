// Local adapter: Lovable deploys this function folder plus _shared, not sibling
// folders. Keep the two sender copies byte-equal; the shared analytics remains
// canonical and is called with bounded inputs instead of changing bot releases.
import {
  prepareAnalyticsDeliveries as prepareSharedDeliveries,
  prepareAnalyticsTracking as prepareSharedTracking,
  type AnalyticsRecipient, type AnalyticsDelivery, type AnalyticsLink,
  type AnalyticsTracking, type BroadcastAnalyticsContext,
} from "../_shared/broadcastAnalytics.ts";

/** PostgREST encodes IN values in the GET URL. Bound both count and encoded
 * length, including long Telegram recipient keys and tracking UUIDs. */
export function chunkAnalyticsRead<T>(items: T[], key: (item: T) => string): T[][] {
  const batches: T[][] = [];
  let batch: T[] = [];
  let length = 0;
  for (const item of items) {
    const encodedLength = encodeURIComponent(key(item)).length + 3;
    if (batch.length && (batch.length >= 50 || length + encodedLength > 3000)) {
      batches.push(batch);
      batch = [];
      length = 0;
    }
    batch.push(item);
    length += encodedLength;
  }
  if (batch.length) batches.push(batch);
  return batches;
}


export async function prepareAnalyticsDeliveries(client: any, context: BroadcastAnalyticsContext, recipients: AnalyticsRecipient[]): Promise<AnalyticsDelivery[]> {
  const deliveries: AnalyticsDelivery[] = [];
  for (const batch of chunkAnalyticsRead(recipients, (recipient) => recipient.recipientKey)) {
    deliveries.push(...await prepareSharedDeliveries(client, context, batch));
  }
  return deliveries;
}

export async function prepareAnalyticsTracking(client: any, deliveries: AnalyticsDelivery[], links: AnalyticsLink[], includeOpenToken: boolean): Promise<Map<string, AnalyticsTracking>> {
  const tracking = new Map<string, AnalyticsTracking>();
  for (const batch of chunkAnalyticsRead(deliveries, (delivery) => delivery.id)) {
    for (const [id, tokens] of await prepareSharedTracking(client, batch, links, includeOpenToken)) tracking.set(id, tokens);
  }
  return tracking;
}
