export async function requestToken(req: Request): Promise<string | null> {
  const url = new URL(req.url)
  let token = url.searchParams.get('token')

  if (req.method !== 'POST') return token

  const contentType = req.headers.get('content-type') ?? ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    const params = new URLSearchParams(await req.text())
    // RFC 8058 clients send the token in the query string. Keep accepting the
    // former page's form body too, so old links remain usable.
    if (!params.has('List-Unsubscribe')) token = params.get('token') ?? token
    return token
  }

  try {
    const body = await req.json()
    return typeof body?.token === 'string' ? body.token : token
  } catch {
    return token
  }
}
