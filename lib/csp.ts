// Content-Security-Policy and the rest of the response hardening (LC-012).
//
// There are two HTML surfaces behind this app and they have opposite
// constraints, so they get two policies:
//
//  - "console": Next.js pages rendered per request (the console itself and
//    the login page). Every inline script Next emits can carry a per-request
//    nonce, so this surface gets the strict policy: no 'unsafe-inline' for
//    script, 'strict-dynamic' so the framework bundle can load its own
//    chunks, and nothing may be framed.
//
//  - "document": the generated client documents in lib/templates. Those are
//    rendered ONCE, stored in R2 as immutable HTML, and served much later by
//    app/c/[slug]/[doc]/route.ts. A stored byte-for-byte-identical file can
//    never receive a per-request nonce, and a hash allowlist is not workable
//    either: the accept-quotation and sign-contract blocks in
//    lib/templates/docs.ts are generated per document, so every document has
//    its own script hashes and the proxy would have to read the body out of
//    R2 to compute them on every request. So this surface keeps
//    'unsafe-inline' for script and buys back what it can: no 'unsafe-eval',
//    no plugins, no base-uri hijack, a fixed form-action, and a default-src
//    that stops the document reaching any third-party origin. That is still
//    a real improvement over today (no CSP at all), and the documents only
//    ever render text the templates escaped through esc().
//
// The client subdomains serve the portal (a Next.js page) from the same host
// as those documents, which is the other reason this surface stays
// inline-friendly: one host cannot carry two policies.
//
// Google Fonts is the one third-party origin the documents load, via a
// stylesheet <link> in lib/templates/shell.ts. The console does not need it:
// next/font self-hosts.

export type Surface = "console" | "document";

const FONT_CSS = "https://fonts.googleapis.com";
const FONT_FILES = "https://fonts.gstatic.com";

/** 128 bits of randomness, base64. Fresh per request: a predictable nonce is
 *  the same as no nonce at all. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** The policy for `surface`. `nonce` is required by the console surface; a
 *  console response built without one falls back to script-src 'self', which
 *  is strictly safer but breaks the inline theme script, so callers should
 *  always pass one. */
export function cspFor(surface: Surface, nonce: string | null): string {
  // React reconstructs server stacks with eval in development only, and the
  // dev server talks to the page over a websocket. Neither is true of a
  // production build, so neither is granted there.
  const dev = process.env.NODE_ENV === "development";

  const shared = [
    "default-src 'self'",
    "img-src 'self' data: blob:",
    // Inline STYLE stays allowed on both surfaces: 36 console components use
    // React `style={{…}}` props and a nonce cannot whitelist a style
    // attribute (that needs 'unsafe-hashes'). Styles are not script, and
    // script injection is what this policy exists to stop.
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];

  if (surface === "console") {
    return [
      ...shared,
      `script-src 'self'${nonce ? ` 'nonce-${nonce}' 'strict-dynamic'` : ""}${dev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      `connect-src 'self'${dev ? " ws:" : ""}`,
      "frame-src 'none'",
      "manifest-src 'self'",
      "worker-src 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; ");
  }

  return [
    ...shared,
    // The client portal at /c/<slug> is a React page served under this policy,
    // not a stored document, and Next's dev-mode refresh runtime uses eval().
    // Without this the portal cannot hot-reload while it is being worked on.
    // Production is unaffected: there is no eval in a built bundle, and the
    // `dev` guard keeps the shipped policy exactly as strict as it was.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' ${FONT_CSS}`,
    `font-src 'self' data: ${FONT_FILES}`,
    "connect-src 'self'",
    // Matches the X-Frame-Options: SAMEORIGIN the client sites already sent.
    // The console previews a client document at /c/<slug>/<doc>, so this is
    // deliberately not 'none'.
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

/** Every security header a response on `surface` should carry. */
export function securityHeaders(surface: Surface, nonce: string | null): Record<string, string> {
  const console_ = surface === "console";
  return {
    "Content-Security-Policy": cspFor(surface, nonce),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // preload: the apex and every subdomain are ours and HTTPS-only, which
    // is the precondition for submitting to the preload list.
    "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
    "X-Frame-Options": console_ ? "DENY" : "SAMEORIGIN",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    // Severs the opener relationship, so a page we open (or that opens us)
    // cannot reach back into this window.
    "Cross-Origin-Opener-Policy": "same-origin",
    // Console assets are for the console alone. Client sites are one origin
    // per client but share the parent domain with the console, and documents
    // link to sibling hosts, so they get the same-site variant.
    "Cross-Origin-Resource-Policy": console_ ? "same-origin" : "same-site",
  };
}
