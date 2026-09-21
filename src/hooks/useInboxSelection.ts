import { useEffect, useRef } from "react";
import type { UnifiedContactRow } from "./useUnifiedInbox";

/** The work queue is paginated and filtered; leaving it does not close a chat. */
export function useInboxSelection(rows: UnifiedContactRow[], key: string | null, sourceKey: string | null, operatorId?: string) {
  const previous = useRef<{ row: UnifiedContactRow; operatorId?: string }>();
  const current = key ? rows.find(row => row.key === key) ?? rows.find(row =>
    sourceKey && row.availableSources.some(source => row.channels[source]?.key === sourceKey),
  ) : undefined;
  const cached = previous.current?.operatorId === operatorId ? previous.current?.row : undefined;
  const selected = current ?? (key && cached && (cached.key === key || cached.availableSources.some(source => cached.channels[source]?.key === sourceKey)) ? cached : null);
  useEffect(() => { previous.current = selected ? { row: selected, operatorId } : undefined; }, [selected, operatorId]);
  return selected;
}
