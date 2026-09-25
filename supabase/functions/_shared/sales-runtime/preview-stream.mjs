/** Keep the read-only synthetic preview connection active while model calls run. */
export function streamSyntheticPreview(run, heartbeatMs = 10000) {
  const encoder = new TextEncoder();
  let interval;
  let active = true;
  const body = new ReadableStream({
    start(controller) {
      const write = value => {
        if (!active) return;
        try { controller.enqueue(encoder.encode(value)); }
        catch { active = false; }
      };
      write(' \n');
      interval = setInterval(() => write(' \n'), heartbeatMs);
      Promise.resolve().then(run).then(result => write(JSON.stringify(result)), () =>
        write(JSON.stringify({ok:false,error:'runtime_failed',stage:'model'})))
        .finally(() => {
          clearInterval(interval);
          if (active) controller.close();
          active = false;
        });
    },
    cancel() { active = false; clearInterval(interval); },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
  });
}
