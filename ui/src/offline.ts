import cdnMap from './cdnMap.json';

// Same rules as server/offline.py: well-known CDN URLs → the copies in /vendor, so pages render offline.
const RULES = (cdnMap.rules as [string, string][]).map(([pat, rep]) => [new RegExp('(?:https?:)?' + pat, 'g'), rep] as const);
const SRI = /(<(?:script|link)\b[^>]*?["']\/vendor\/[^>]*?)\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')/gi;
const SRI_AFTER = /(<(?:script|link)\b[^>]*?)\s+integrity\s*=\s*(?:"[^"]*"|'[^']*')([^>]*?["']\/vendor\/)/gi;

/** Point known CDN URLs at /vendor. The CDN's SRI hash won't match the local copy, so it goes too. */
export function localizeCdn(text: string): string {
  if (!text.includes('//')) return text;
  let out = text;
  for (const [rx, rep] of RULES) out = out.replace(rx, (_m, g1?: string) => rep.replace('$1', typeof g1 === 'string' ? g1 : ''));
  if (out !== text && out.includes('integrity')) out = out.replace(SRI, '$1').replace(SRI_AFTER, '$1$2');
  return out;
}
