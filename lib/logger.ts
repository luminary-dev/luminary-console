// Structured logging (LC-017).
//
// One line of JSON per event, with every field routed through lib/redact
// first. The point is not prettiness: Vercel's log drain groups and searches
// on JSON fields, and a redactor that has to be remembered at each call site
// is a redactor that will be forgotten. So there is exactly one way to log
// through this module, and it always redacts.
//
// Deliberately tiny and dependency-free: this is imported by request paths
// where pulling a logging framework in would cost more than it returns.
import { redact, redactString } from "./redact";

export type LogLevel = "info" | "warn" | "error";

/** Structured context for one event. `requestId` is promoted to a top-level
 *  field because correlating one request's lines is the main thing anyone
 *  ever does with these logs; everything else rides along under `data`. */
export type LogFields = {
  requestId?: string;
  [key: string]: unknown;
};

type Line = {
  ts: string;
  level: LogLevel;
  msg: string;
  requestId?: string;
  data?: Record<string, unknown>;
};

// console.log is the one sink that reaches stdout on both the Node and Edge
// runtimes; process.stdout does not exist on Edge. The lint rule that pushes
// callers towards warn/error is aimed at stray debugging, which is exactly
// what this module exists to replace.
const sinks: Record<LogLevel, (line: string) => void> = {
  // eslint-disable-next-line no-console
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function emit(level: LogLevel, msg: string, fields?: LogFields): void {
  const line: Line = {
    ts: new Date().toISOString(),
    level,
    // The message is a secret carrier too: `logger.error(\`failed: ${url}\`)`
    // with a presigned URL in it is the common shape of this mistake.
    msg: redactString(msg),
  };

  if (fields) {
    const { requestId, ...rest } = fields;
    if (requestId) line.requestId = redactString(String(requestId));
    if (Object.keys(rest).length > 0) {
      line.data = redact(rest) as Record<string, unknown>;
    }
  }

  // A value that will not serialise (a BigInt slipping past the redactor, a
  // getter that throws) must not take the request down with it.
  let text: string;
  try {
    text = JSON.stringify(line);
  } catch {
    text = JSON.stringify({ ts: line.ts, level, msg: line.msg, data: "[unserialisable]" });
  }
  sinks[level](text);
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),

  /** A logger with fields pre-bound, so a request handler sets `requestId`
   *  once instead of on every line. */
  child(bound: LogFields) {
    return {
      info: (msg: string, fields?: LogFields) => emit("info", msg, { ...bound, ...fields }),
      warn: (msg: string, fields?: LogFields) => emit("warn", msg, { ...bound, ...fields }),
      error: (msg: string, fields?: LogFields) => emit("error", msg, { ...bound, ...fields }),
    };
  },
};

export type Logger = typeof logger;
