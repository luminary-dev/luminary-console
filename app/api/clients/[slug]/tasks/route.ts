// Per-client operator checklist: add / toggle / remove. Console-only, never
// client-facing. Indices come from the rendered list, so every mutation
// re-validates them against the stored array before touching it — inside the
// compare-and-swap closure, so it re-checks the FRESH array on retry (API-02).
import { NextResponse } from "next/server";
import { updateClient, StoreConflictError } from "@/lib/store";
import { ADMIN_NAMES } from "@/lib/admins";
import type { Task } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TEXT = 300;
const MAX_TASKS = 100;

/** State-dependent validation signals failure with this rather than a Response,
 *  so it can run inside the replayable mutate closure. */
class Reject {
  constructor(
    readonly status: number,
    readonly message: string,
  ) {}
}

function conflict(e: unknown): NextResponse | null {
  if (e instanceof Reject) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof StoreConflictError) {
    return NextResponse.json(
      { error: "That client was being edited at the same time. Please retry." },
      { status: 409 },
    );
  }
  return null;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");

  try {
    if (action === "add") {
      const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
      if (!text) return NextResponse.json({ error: "Task text required." }, { status: 400 });
      const due =
        typeof body.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due) ? body.due : undefined;
      const assignee =
        typeof body.assignee === "string" && body.assignee in ADMIN_NAMES ? body.assignee : undefined;
      const task: Task = {
        text,
        done: false,
        at: new Date().toISOString(),
        ...(due ? { due } : {}),
        ...(assignee ? { assignee } : {}),
      };
      const updated = await updateClient(slug, (client) => {
        const tasks = client.tasks ?? [];
        if (tasks.length >= MAX_TASKS) {
          throw new Reject(400, `That's ${MAX_TASKS} tasks. Clear some done ones first.`);
        }
        client.tasks = [...tasks, task];
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      return NextResponse.json({ ok: true, tasks: updated.tasks });
    }

    const index = Number(body.index);

    if (action === "toggle") {
      const updated = await updateClient(slug, (client) => {
        const tasks = client.tasks ?? [];
        const t = tasks[index];
        if (!Number.isInteger(index) || !t) throw new Reject(404, "No such task.");
        tasks[index] = { ...t, done: !t.done };
        client.tasks = tasks;
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      return NextResponse.json({ ok: true, tasks: updated.tasks });
    }

    if (action === "remove") {
      const updated = await updateClient(slug, (client) => {
        const tasks = client.tasks ?? [];
        if (!Number.isInteger(index) || !tasks[index]) throw new Reject(404, "No such task.");
        client.tasks = tasks.filter((_, i) => i !== index);
      });
      if (!updated) return NextResponse.json({ error: "Client not found" }, { status: 404 });
      return NextResponse.json({ ok: true, tasks: updated.tasks });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    const handled = conflict(e);
    if (handled) return handled;
    throw e;
  }
}
