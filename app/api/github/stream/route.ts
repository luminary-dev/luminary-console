// Server-Sent Events: the live update channel for the console.
//
// SSE rather than WebSockets because the traffic is one-directional (server
// tells the browser something changed) and SSE reconnects itself, carries a
// resume cursor in Last-Event-ID, and survives proxies that mangle upgrades.
//
// What this deliberately does NOT do is push entity payloads. It pushes a
// CURSOR: "something in this collection changed as of T". The client then
// refetches what it is actually looking at. Two reasons:
//
//   1. The mandate requires that a live update never steals scroll or
//      selection and never re-renders rows that did not change. A client that
//      owns its own refetch can diff and patch; a client handed a payload
//      mid-scroll cannot.
//   2. On reconnect we must "fetch the delta rather than the world", and a
//      cursor is exactly the delta primitive.
//
// Polling remains the documented fallback: every consumer works without this
// endpoint, just less promptly.
import { NextResponse } from "next/server";
import { listDeliveries } from "@/lib/github/inbox";
import { githubConfigured } from "@/lib/github/config";

export const runtime = "nodejs";
// SSE holds the connection open. This is the ceiling before the platform
// closes it; the client reconnects and resumes from its cursor.
export const maxDuration = 300;

/** How often we look for changes. Webhook to visible UI needs to be under two
 *  seconds, and the receive path plus this interval has to fit inside that. */
const POLL_MS = 1_500;

/** A heartbeat stops intermediaries closing an idle connection, and gives the
 *  browser something to notice when the network has quietly gone away. */
const HEARTBEAT_MS = 20_000;

export async function GET(req: Request) {
  if (!githubConfigured()) {
    return NextResponse.json(
      { error: "GitHub is not configured on this deployment." },
      { status: 503 },
    );
  }

  // Resume point. The browser sends the last id it saw automatically on a
  // reconnect, so a dropped connection does not replay the world.
  const lastEventId = req.headers.get("last-event-id");
  let cursor = Number(lastEventId);
  if (!Number.isFinite(cursor) || cursor <= 0) cursor = Date.now();

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        const lines = [
          ...(id !== undefined ? [`id: ${id}`] : []),
          `event: ${event}`,
          `data: ${JSON.stringify(data)}`,
          "",
          "",
        ].join("\n");
        try {
          controller.enqueue(encoder.encode(lines));
        } catch {
          // The client went away between our check and the enqueue.
          closed = true;
        }
      };

      // Tell the client where it is resuming from, so it can decide whether
      // it needs a full refetch or just a delta.
      send("ready", { since: cursor, pollFallbackMs: 15_000 }, cursor);

      const deadline = Date.now() + (maxDuration - 10) * 1000;
      let lastHeartbeat = Date.now();

      while (!closed && Date.now() < deadline) {
        if (req.signal.aborted) break;

        try {
          // Deliveries processed since the cursor are the change signal. This
          // reads the inbox rather than the projection because the inbox is
          // what carries a timestamp we can compare cheaply.
          const recent = await listDeliveries({ max: 50 });
          const changed = recent.filter((d) => {
            const at = Date.parse(d.processedAt ?? d.receivedAt);
            return Number.isFinite(at) && at > cursor && d.state === "processed";
          });

          if (changed.length) {
            const newest = Math.max(
              ...changed.map((d) => Date.parse(d.processedAt ?? d.receivedAt)),
            );
            cursor = newest;
            // Collections, not entities: the client refetches what it is
            // showing rather than being handed rows to splice in.
            const collections = [...new Set(changed.map((d) => collectionFor(d.event)))].filter(
              (c): c is string => c !== null,
            );
            const repos = [...new Set(changed.map((d) => d.repo).filter(Boolean))];
            send("changed", { collections, repos, since: cursor, count: changed.length }, cursor);
            lastHeartbeat = Date.now();
          } else if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
            send("heartbeat", { at: Date.now() });
            lastHeartbeat = Date.now();
          }
        } catch (e) {
          // A store hiccup must not kill the stream: the client would
          // reconnect immediately and hammer us. Report and keep going.
          send("warning", { message: e instanceof Error ? e.message : "read failed" });
        }

        await new Promise((r) => setTimeout(r, POLL_MS));
      }

      // Ask the client to reconnect deliberately, rather than letting the
      // connection die and relying on the browser's own timing.
      send("bye", { reason: "cycle", resumeFrom: cursor });
      closed = true;
      try {
        controller.close();
      } catch {
        // Already closed by the client disconnecting.
      }
    },
    cancel() {
      closed = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Nginx and some proxies buffer by default, which defeats SSE entirely.
      "X-Accel-Buffering": "no",
    },
  });
}

/** Which console collection an event type affects, so a client showing pull
 *  requests is not woken by a release. */
function collectionFor(event: string): string | null {
  if (event.startsWith("pull_request") || event === "issue_comment") return "pull_requests";
  if (event === "check_run" || event === "check_suite" || event === "status") return "pull_requests";
  if (event === "workflow_run" || event === "workflow_job") return "workflow_runs";
  if (event === "deployment" || event === "deployment_status") return "deployments";
  if (event === "release") return "releases";
  if (event === "repository" || event === "push") return "repositories";
  if (event.endsWith("_alert")) return "alerts";
  if (event === "issues") return "issues";
  return null;
}
