/**
 * Normalizes an Instagram handle input to a clean username.
 * 
 * Accepts: @username, https://instagram.com/username, https://www.instagram.com/username/, username
 * Returns: lowercase username without @ or URL prefix, or null if empty/invalid.
 * 
 * NOTE: profiles.instagram_url stores normalized handle (not full URL) despite legacy column name.
 */
export function normalizeInstagram(value: string | null | undefined): string | null {
  if (!value) return null;
  
  let cleaned = value.trim();
  if (!cleaned) return null;
  
  // Remove URL prefix variations
  cleaned = cleaned.replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  // Remove trailing slash
  cleaned = cleaned.replace(/\/$/, "");
  // Remove @ prefix
  cleaned = cleaned.replace(/^@/, "");
  // Lowercase
  cleaned = cleaned.toLowerCase().trim();
  
  // Basic validation: Instagram usernames are alphanumeric + dots + underscores, 1-30 chars
  if (!cleaned || cleaned.length > 30 || !/^[a-z0-9._]+$/.test(cleaned)) {
    return null;
  }
  
  return cleaned;
}
