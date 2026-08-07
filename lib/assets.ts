// Asset references — isomorphic (the questionnaire form and the submit route
// both parse them), so this module must not import the S3 SDK.
//
// R2 is a PRIVATE bucket: nothing in it is publicly readable. An asset is
// therefore stored on the record as an app-relative URL onto the authed
// streaming route, "/api/asset/<key>", rather than as a public CDN link.
// Each key segment is percent-encoded so file names with spaces or brackets
// survive an href; `assetKey` reverses that and is the single place where a
// reference is turned back into a bucket key.
export const ASSET_ROUTE = "/api/asset/";

/** Every key this app writes lives under one prefix — nothing else in the
 *  bucket is reachable through the asset route. */
export const STORE_PREFIX = "console/";

/** Bucket key → the app URL we persist on records. */
export function assetUrl(key: string): string {
  return ASSET_ROUTE + key.split("/").map(encodeURIComponent).join("/");
}

function decodePath(path: string): string | null {
  try {
    return path.split("/").map(decodeURIComponent).join("/");
  } catch {
    return null; // malformed percent-escape
  }
}

/** Stored reference → bucket key, or null if it isn't one of ours.
 *  Accepts the app URL form ("/api/asset/console/…", absolute or relative)
 *  and a bare key ("console/…"); legacy absolute Vercel Blob URLs return null
 *  so callers can fall back to a plain fetch. Traversal is rejected here so
 *  every consumer inherits the check. */
export function assetKey(ref: string): string | null {
  if (typeof ref !== "string" || !ref) return null;
  let key: string | null = ref;
  if (/^https?:\/\//i.test(ref)) {
    let path: string;
    try {
      path = new URL(ref).pathname;
    } catch {
      return null;
    }
    if (!path.startsWith(ASSET_ROUTE)) return null;
    key = decodePath(path.slice(ASSET_ROUTE.length));
  } else if (ref.startsWith(ASSET_ROUTE)) {
    key = decodePath(ref.slice(ASSET_ROUTE.length));
  }
  if (!key || !key.startsWith(STORE_PREFIX)) return null;
  const parts = key.split("/");
  if (parts.includes("..") || parts.includes(".") || parts.some((p) => p === "")) return null;
  return key;
}
