// Prove the deployed canonical writer before planning or applying a paid
// continuation. The existing runtime client keeps its credential server-side.
export async function requireExactGrantCapability(client: {
  functions: { invoke: (name: string, options: { method: 'GET' }) => Promise<{ data?: any; error?: unknown }> };
}) {
  try {
    const result = await client.functions.invoke('grant-access-for-order', { method: 'GET' });
    if (!result.error && result.data?.capabilities?.exact_existing_access_v1 === true) return;
  } catch {
    // Fail closed with no response body, credential or provider data in logs.
  }
  throw new Error('recovery_exact_grant_capability_unavailable');
}
