// Per-client operator checklist: add / toggle / remove. Console-only, never
// client-facing. Indices come from the rendered list, so every mutation
// re-validates them against the stored array before touching it.
import { NextResponse } from "next/server";
import { getClient, saveClient } from "@/lib/store";
import { ADMIN_NAMES } from "@/lib/admins";
import type { Task } from "@/lib/types";

export const runtime = "nodejs";

const MAX_TEXT = 300;
const MAX_TASKS = 100;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const tasks = client.tasks ?? [];

  if (action === "add") {
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT) : "";
    if (!text) return NextResponse.json({ error: "Task text required." }, { status: 400 });
    if (tasks.length >= MAX_TASKS) {
      return NextResponse.json(
        { error: `That's ${MAX_TASKS} tasks. Clear some done ones first.` },
        { status: 400 },
      );
    }
    const due = typeof body.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.due) ? body.due : undefined;
    const assignee = typeof body.assignee === "string" && body.assignee in ADMIN_NAMES ? body.assignee : undefined;
    const task: Task = {
      text,
      done: false,
      at: new Date().toISOString(),
      ...(due ? { due } : {}),
      ...(assignee ? { assignee } : {}),
    };
    client.tasks = [...tasks, task];
    await saveClient(client);
    return NextResponse.json({ ok: true, tasks: client.tasks });
  }

  const index = Number(body.index);
  if (!Number.isInteger(index) || !tasks[index]) {
    return NextResponse.json({ error: "No such task." }, { status: 404 });
  }

  if (action === "toggle") {
    tasks[index] = { ...tasks[index], done: !tasks[index].done };
    client.tasks = tasks;
    await saveClient(client);
    return NextResponse.json({ ok: true, tasks: client.tasks });
  }

  if (action === "remove") {
    client.tasks = tasks.filter((_, i) => i !== index);
    await saveClient(client);
    return NextResponse.json({ ok: true, tasks: client.tasks });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
