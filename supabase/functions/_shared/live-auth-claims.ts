export interface LiveAuthClaimsResponse {
  data?: {
    claims?: {
      sub?: string | null;
    } | null;
  } | null;
  error?: unknown;
}

export interface LiveAuthVerification {
  userId: string | null;
  error: unknown | null;
}

/**
 * Supabase Auth may either return an error or throw while parsing a malformed
 * JWT. Normalize both outcomes so callers can keep authentication fail-closed.
 */
export async function verifyLiveBearerClaims(
  getClaims: () => Promise<LiveAuthClaimsResponse>,
): Promise<LiveAuthVerification> {
  try {
    const { data, error } = await getClaims();
    const subject = data?.claims?.sub;

    if (error || typeof subject !== 'string' || subject.length === 0) {
      return {
        userId: null,
        error: error ?? new Error('missing_subject'),
      };
    }

    return { userId: subject, error: null };
  } catch (error) {
    return { userId: null, error };
  }
}
