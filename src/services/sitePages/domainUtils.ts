/**
 * Canonical domain normalization — hostname only.
 * Strips protocol, path, query, fragment, port, trailing dot.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');   // strip protocol
  d = d.replace(/\/.*$/, '');           // strip path/query/fragment
  d = d.replace(/:[\d]+$/, '');         // strip port
  d = d.replace(/\.+$/, '');            // strip trailing dot
  if (!d) throw new Error("Domain cannot be empty");
  return d;
}
