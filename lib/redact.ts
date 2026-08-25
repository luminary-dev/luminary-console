// Log redaction (LC-017).
//
// Everything this app logs on a failure path is something a third party
// handed us: a Resend error object, an S3 error carrying the presigned URL it
// failed on, a webhook delivery, a caught Error whose `cause` is the raw
// fetch response. Those routinely contain the one class of value that must
// never reach a log line: a credential, a signature, or a client's contact
// details. So the redactor is deliberately BOTH:
//
//   - key-aware, because a value under `authorization` is a secret whatever
//     it looks like, and
//   - pattern-aware, because the same secret usually arrives glued into the
//     middle of a message string ("... 401 for Bearer sk-ant-..."), where no
//     key name protects it.
//
// The bar for a pattern here is that it must not mangle ordinary prose. That
// is why, for example, the phone matchers require a leading + or a leading 0
// with a full national-length run of digits rather than "any group of digits
// that could be a number", and why 32-hex is NOT redacted (ETags, MD5s and
// hyphen-stripped UUIDs are all 32 hex and are all things we want to keep in
// a log line).

/** Every redacted value collapses to this, so a log line still shows the
 *  SHAPE of what was there without carrying the value. */
export const REDACTED = "[redacted]";

/** How deep the walker follows nested structures before giving up. Provider
 *  error objects nest a handful of levels; anything past this is a cycle or a
 *  parsed document, and neither belongs in a log line. */
const MAX_DEPTH = 8;

/** Keys whose VALUE is a secret regardless of its shape. Matched loosely
 *  (substring, case-insensitive) because the same field arrives as
 *  `Authorization`, `authorization`, `authHeader`, `accessToken`,
 *  `secretAccessKey`, `x-amz-credential`, `X-Hub-Signature-256`, ... */
const SENSITIVE_KEY =
  /(authorization|auth[-_]?header|cookie|secret|password|passphrase|credential|signature|api[-_]?key|access[-_]?key|private[-_]?key|session[-_]?id|[-_]?token|otp\b|vapid)/i;

/** Keys that trip SENSITIVE_KEY but hold no secret. Without this, ordinary
 *  diagnostics (how many tokens a model call used) would be redacted and the
 *  logs would be less useful for no security gain. */
const SAFE_KEY = /^(token|input|output|total|prompt|completion|cache)?[-_]?tokens?(used|count|_used|_count)?$/i;

type Replacement = [RegExp, string];

// Ordered: the more specific pattern must run before the more general one it
// would otherwise be swallowed by (a sha256= signature before the bare 64-hex
// rule; sk-ant- before sk-).
const PATTERNS: Replacement[] = [
  // Presigned R2/S3 links. The URL is worth keeping in a log (it names the
  // key that failed); the signing material is not, so only the value goes.
  [
    /([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s"'>]+/gi,
    `$1${REDACTED}`,
  ],
  // An Authorization header pasted into a message, with or without a scheme,
  // as a raw header line ("Authorization: Bearer x") or as a JSON field
  // ({"authorization":"Bearer x"}). It consumes to the end of the VALUE, not
  // the end of the first word, so the whole thing collapses to one marker.
  [/\b(authorization["']?\s*[:=]\s*["']?)[^\n\r,;)"']+/gi, `$1${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi, `Bearer ${REDACTED}`],
  // A whole Cookie / Set-Cookie header value, in either of the same shapes.
  [/\b(set-cookie|cookie)(["']?\s*[:=]\s*["']?)[^\n\r"']+/gi, `$1$2${REDACTED}`],
  // The session cookie on its own, e.g. inside a raw `cookie` string.
  [/\blum_(session|pending)=[^\s;"']+/gi, `lum_$1=${REDACTED}`],
  // A bare session token: "<absExp>.<idleExp>.<16 hex sid>.<b64url sig>"
  // (lib/auth.ts). Matched by shape so it is caught even when it arrives
  // without its cookie name.
  [/\b\d{13}\.\d{13}\.[0-9a-f]{16}\.[A-Za-z0-9_-]{20,}/g, REDACTED],
  // Webhook signatures (GitHub sends sha256=<hex>).
  [/\b(sha(?:1|256)=)[A-Fa-f0-9]{20,}/gi, `$1${REDACTED}`],
  // Provider API keys.
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, REDACTED],
  [/\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, REDACTED],
  [/\bre_[A-Za-z0-9_-]{12,}/g, REDACTED],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/g, REDACTED],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/g, REDACTED],
  // AWS-style access key ids. R2 issues hex ids instead, which are covered by
  // the key-name rule above (accessKeyId / R2_ACCESS_KEY_ID) rather than by a
  // pattern, because a bare 32-hex string is far more often an ETag.
  [/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA)[0-9A-Z]{16}\b/g, REDACTED],
  // R2/S3 secret access keys are 64 hex. A 64-hex run is never something we
  // want in a log line anyway.
  [/\b[0-9a-f]{64}\b/gi, REDACTED],
  // PII. Emails first: an address can contain digits the phone rules would
  // otherwise chew on.
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g, REDACTED],
  // Phone numbers, deliberately narrow: an international number must carry
  // its +, and a national one must be a full 10-digit 0-prefixed run (or the
  // spaced/hyphenated form of one). "2026-08-26" and "0.0015" do not match.
  [/\+\d[\d\s().-]{6,17}\d/g, REDACTED],
  [/\b0\d{2}[\s.-]\d{3}[\s.-]?\d{4}\b/g, REDACTED],
  [/\b0\d{9}\b/g, REDACTED],
];

/** Scrub secrets out of a single string, leaving the rest of it readable. */
export function redactString(input: string): string {
  let out = input;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out;
}

function isSensitiveKey(key: string): boolean {
  if (SAFE_KEY.test(key)) return false;
  return SENSITIVE_KEY.test(key);
}

/** Errors are the main thing this app logs, so they get first-class handling
 *  rather than falling through to the plain-object walker: `message`, `stack`
 *  and `name` are non-enumerable, and `cause` (where the underlying provider
 *  response usually hides) would otherwise be dropped entirely. */
function isError(value: object): value is Error {
  return value instanceof Error;
}

function redactError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: redactString(err.message),
  };
  if (err.stack) out.stack = redactString(err.stack);
  if (err.cause !== undefined) out.cause = walk(err.cause, depth + 1, seen);
  // Provider SDKs hang status codes and response bodies off the error as own
  // enumerable properties; those are the useful part, so keep them (redacted).
  for (const [k, v] of Object.entries(err)) {
    if (k === "name" || k === "message" || k === "stack" || k === "cause") continue;
    out[k] = isSensitiveKey(k) ? REDACTED : walk(v, depth + 1, seen);
  }
  return out;
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  const type = typeof value;
  if (type === "string") return redactString(value as string);
  if (type === "number" || type === "boolean") return value;
  if (type === "bigint") return `${(value as bigint).toString()}n`;
  if (type === "symbol") return (value as symbol).toString();
  if (type === "function") return "[function]";

  const obj = value as object;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (seen.has(obj)) return "[circular]";
  seen.add(obj);

  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof URL) return redactString(obj.href);
  if (obj instanceof RegExp) return obj.toString();
  if (isError(obj)) return redactError(obj, depth, seen);

  if (Array.isArray(obj)) return obj.map((v) => walk(v, depth + 1, seen));

  // Headers/Map/Set are the shapes a fetch boundary hands us, and none of
  // them survive Object.entries(), so they are unwrapped explicitly rather
  // than logged as "{}".
  if (obj instanceof Headers) {
    const out: Record<string, unknown> = {};
    obj.forEach((v, k) => {
      out[k] = isSensitiveKey(k) ? REDACTED : redactString(v);
    });
    return out;
  }
  if (obj instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of obj.entries()) {
      const key = String(k);
      out[key] = isSensitiveKey(key) ? REDACTED : walk(v, depth + 1, seen);
    }
    return out;
  }
  if (obj instanceof Set) return [...obj].map((v) => walk(v, depth + 1, seen));

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = isSensitiveKey(k) ? REDACTED : walk(v, depth + 1, seen);
  }
  return out;
}

/** Redact anything: a string, an Error (including its `cause` chain), a
 *  provider response object, or an arbitrarily nested mix of those. Returns a
 *  NEW structure; the input is never mutated, so redaction can never change
 *  what the caller goes on to do with the value. */
export function redact(value: unknown): unknown {
  return walk(value, 0, new WeakSet<object>());
}
