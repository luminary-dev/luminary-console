// Design prototype previews: the 3 concepts promised in the SOW, each a single
// self-contained HTML file. They are served as PATHS under the client's
// existing subdomain (e.g. https://eco-mech.luminary-dev.xyz/design/1), so no
// per-design DNS is needed and they work wherever the client site already does.
//
// Pure helpers only (no S3 SDK) so anything can import them cheaply.

/** How many design concepts a client may have — the SOW promises 3. */
export const MAX_DESIGNS = 3;

/** Uploaded design files are single self-contained HTML pages; cap the size so
 *  a stray asset (an un-inlined video, a mis-picked file) can't be stored. */
export const DESIGN_HTML_MAX_BYTES = 3 * 1024 * 1024; // 3 MB

/** Public path for a design slot on the client host, e.g. "/design/2". */
export const designPath = (id: string) => `/design/${id}`;

/** Full public URL, e.g. "https://eco-mech.luminary-dev.xyz/design/2".
 *  `clientDomain` is the client record's `domain` (<slug>.ROOT). */
export const designUrl = (clientDomain: string, id: string) => `https://${clientDomain}${designPath(id)}`;
