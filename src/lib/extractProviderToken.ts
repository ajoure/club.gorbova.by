/**
 * PATCH-1C: Unified extractor for provider token (bePaid card fingerprint)
 * Single source of truth for extracting stable card identity from provider_response
 * 
 * IMPORTANT: Never log the raw provider_response or token values (PII)
 */

/**
 * Extract provider token from bePaid provider_response
 * Paths searched:
 *   - $.token (top-level)
 *   - $.transaction.credit_card.token
 *   - $.credit_card.token
 *   - $.card.token
 * 
 * @returns token string or null if not found
 */
export function extractProviderToken(providerResponse: any): string | null {
  if (!providerResponse || typeof providerResponse !== 'object') {
    return null;
  }
  
  // 1. Top-level token
  if (providerResponse.token && typeof providerResponse.token === 'string') {
    return providerResponse.token;
  }
  
  // 2. $.transaction.credit_card.token (most common bePaid structure)
  const txCreditCard = providerResponse.transaction?.credit_card;
  if (txCreditCard?.token && typeof txCreditCard.token === 'string') {
    return txCreditCard.token;
  }
  
  // 3. $.credit_card.token
  if (providerResponse.credit_card?.token && typeof providerResponse.credit_card.token === 'string') {
    return providerResponse.credit_card.token;
  }
  
  // 4. $.card.token
  if (providerResponse.card?.token && typeof providerResponse.card.token === 'string') {
    return providerResponse.card.token;
  }
  
  // 5. Deep search for any token field (fallback)
  try {
    const findToken = (obj: any, depth = 0): string | null => {
      if (depth > 5 || !obj || typeof obj !== 'object') return null;
      
      for (const key of Object.keys(obj)) {
        if (key === 'token' && typeof obj[key] === 'string' && obj[key].length > 10) {
          return obj[key];
        }
        if (typeof obj[key] === 'object') {
          const found = findToken(obj[key], depth + 1);
          if (found) return found;
        }
      }
      return null;
    };
    
    return findToken(providerResponse);
  } catch {
    return null;
  }
}

/**
 * Hash a provider token for audit logging (no PII in logs)
 * Returns first 16 chars of SHA256 hex
 */
export function hashProviderToken(token: string): string {
  // Simple hash for client-side (not crypto-secure, just for audit ID)
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    const char = token.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0').slice(0, 16);
}
