import { getAccessAliasOrigin } from '../_shared/access-alias-origin.ts'

const SITE_URL = 'https://gorbova.by'

/**
 * Route signed Auth links through the public SPA proxy. Only the explicitly
 * allow-listed access alias in redirect_to may replace the canonical host.
 */
export function publicAuthConfirmationUrl(data: { url: string }): string {
  try {
    const signedUrl = new URL(data.url)
    const normalized = { redirectTo: signedUrl.searchParams.get('redirect_to') }
    const accessAliasOrigin = getAccessAliasOrigin(normalized.redirectTo)
    const publicUrl = new URL(accessAliasOrigin || SITE_URL)
    publicUrl.pathname = '/auth-verify'
    publicUrl.search = signedUrl.search
    return publicUrl.toString()
  } catch {
    return data.url
  }
}
