import { useEffect, useRef } from "react";

/** A dependent query changing keys is not evidence that the old data vanished.
 * Keep the last successful value through loading/errors; a successful empty
 * response is authoritative. Scope changes (including logout) never reuse it.
 */
export function useRetainedQueryData<T>(data: T | undefined, scope: string | undefined): T | undefined {
  const previous = useRef<{ scope: string | undefined; data: T }>();
  useEffect(() => {
    if (data !== undefined) previous.current = { scope, data };
    else if (previous.current?.scope !== scope) previous.current = undefined;
  }, [data, scope]);
  return data ?? (previous.current?.scope === scope ? previous.current.data : undefined);
}
