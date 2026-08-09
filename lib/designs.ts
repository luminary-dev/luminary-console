// Design prototype previews: the 3 concepts promised in the SOW, each a single
// self-contained HTML file served on its own subdomain (<slug>-d<id>.ROOT).
//
// Pure helpers only (no S3 SDK, no domain calls) so proxy.ts can import them on
// the hot path. The mutating logic lives in the API routes.

const ROOT = process.env.ROOT_DOMAIN || "luminary-dev.xyz";

/** How many design concepts a client may have — the SOW promises 3. */
export const MAX_DESIGNS = 3;

/** Uploaded design files are single self-contained HTML pages; cap the size so
 *  a stray asset (an un-inlined video, a mis-picked file) can't be stored. */
export const DESIGN_HTML_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

/** Subdomain slug for a design slot, e.g. ("eco-mech", "2") -> "eco-mech-d2". */
export const designSlug = (clientSlug: string, id: string) => `${clientSlug}-d${id}`;

/** Full host for a design slug, e.g. "eco-mech-d2.luminary-dev.xyz". */
export const designHost = (dslug: string) => `${dslug}.${ROOT}`;

/** True when a client-host subdomain is a design host (…-d<N>). */
export const isDesignSub = (sub: string) => /-d\d+$/.test(sub);

/** Split a design subdomain back into its owner + slot, or null.
 *  Greedy on the client part so a client slug that itself contains "-d1"
 *  (e.g. "foo-d1-d2") still resolves to the right owner. Callers verify the
 *  parsed owner actually holds a design with this exact dslug. */
export function parseDesignSub(sub: string): { clientSlug: string; id: string } | null {
  const m = /^(.+)-d(\d+)$/.exec(sub);
  return m ? { clientSlug: m[1], id: m[2] } : null;
}
