/** Lowercase host without protocol, path, port, trailing dot or a leading "www.". */
export function normalizeDomain(input: string): string {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/, 1)[0] ?? "";
  host = host.replace(/:\d+$/, "").replace(/\.$/, "");
  return host.startsWith("www.") ? host.slice(4) : host;
}

/**
 * True when a SERP result belongs to the lead's site: same host or a subdomain of it.
 * "shop.example.co.uk" matches "example.co.uk"; "notexample.co.uk" does not.
 */
export function domainMatches(resultDomain: string, leadDomain: string): boolean {
  const lead = normalizeDomain(leadDomain);
  if (!lead) return false;
  const result = normalizeDomain(resultDomain);
  return result === lead || result.endsWith(`.${lead}`);
}
