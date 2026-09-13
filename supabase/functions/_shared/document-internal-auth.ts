/** A caller-controlled JWT payload or marker is never proof of service identity. */
export function isTrustedDocumentServiceCall(headers: Headers, serviceKey: string, marker: string): boolean {
  if (!serviceKey || headers.get('x-internal-call') !== marker) return false;
  const authorization = headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return false;
  const token = authorization.slice(7);
  if (token.length !== serviceKey.length) return false;
  let difference = 0;
  for (let i = 0; i < token.length; i++) difference |= token.charCodeAt(i) ^ serviceKey.charCodeAt(i);
  return difference === 0;
}
