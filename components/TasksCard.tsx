"use client";

// Per-client checklist. Optimistic on every mutation: the server answers
// with the authoritative list, and a failure puts the previous list straight
// back with the reason, so the checkbox never lies about what was stored.
import { useState } from "react";
import type { Task } from "@/lib/types";
import { ADMIN_NAMES, displayName } from "@/lib/admins";
import { useConfirm } from "./ConfirmDialog";
import { opsFetch } from "@/lib/ops-fetch";

const today = () => new Date().toISOString().slice(0, 10);

export default function TasksCard({ slug, tasks }: { slug: string; tasks: Task[] }) {
  const [list, setList] = useState<Task[]>(tasks);
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  const [assignee, setAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const call = async (payload: Record<string, unknown>, optimistic: Task[]) => {
    const before = list;
    setList(optimistic);
    setBusy(true);
    setError(null);
    const res = await opsFetch(`/api/clients/${slug}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res?.ok) {
      setList(before);
      setError(data?.error || "That didn't save. Please try again.");
      return;
    }
    if (Array.isArray(data?.tasks)) setList(data.tasks);
  };

  const add = async () => {
    const t = text.trim();
    if (!t) return;
    const d = due;
    const a = assignee;
    setText("");
    setDue("");
    setAssignee("");
    await call(
      { action: "add", text: t.slice(0, 300), due: d || undefined, assignee: a || undefined },
      [
        ...list,
        { text: t, done: false, at: new Date().toISOString(), ...(d ? { due: d } : {}), ...(a ? { assignee: a } : {}) },
      ],
    );
  };

  const toggle = (i: number) =>
    call(
      { action: "toggle", index: i },
      list.map((t, j) => (j === i ? { ...t, done: !t.done } : t)),
    );

  const remove = async (i: number) => {
    // The row could have gone if the server's authoritative list came back
    // shorter while the click was in flight.
    const task = list[i];
    if (!task) return;
    const sure = await confirm({
      title: "Remove task",
      danger: true,
      confirmLabel: "Remove",
      message: (
        <>
          Remove <b>{task.text}</b> from the checklist?
        </>
      ),
    });
    if (!sure) return;
    await call({ action: "remove", index: i }, list.filter((_, j) => j !== i));
  };

  const open = list.filter((t) => !t.done).length;

  return (
    <div className="card">
      {dialog}
      <div className="ask-head">
        <h3>Tasks</h3>
        {list.length > 0 && (
          <span className="save-state">
            {open} open · {list.length - open} done
          </span>
        )}
      </div>
      {list.length === 0 ? (
        <p className="empty-note">
          Nothing on the list. Add what this client is waiting on: assets, a callback, a domain
          transfer.
        </p>
      ) : (
        <div style={{ marginTop: 10 }}>
          {list.map((t, i) => {
            const overdue = !t.done && t.due && t.due < today();
            return (
            <div className={`task-row${t.done ? " done" : ""}`} key={`${t.at}-${i}`}>
              <input
                type="checkbox"
                checked={t.done}
                disabled={busy}
                onChange={() => toggle(i)}
                aria-label={t.text}
              />
              <span className="task-text">
                {t.text}
                {(t.due || t.assignee) && (
                  <span style={{ marginLeft: 8, fontSize: 11.5, color: overdue ? "var(--danger, #d33)" : "var(--muted)", fontWeight: overdue ? 700 : 400 }}>
                    {t.due ? `due ${t.due}${overdue ? " · overdue" : ""}` : ""}
                    {t.due && t.assignee ? " · " : ""}
                    {t.assignee ? displayName(t.assignee) : ""}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="task-x"
                aria-label={`Remove ${t.text}`}
                disabled={busy}
                onClick={() => remove(i)}
              >
                ×
              </button>
            </div>
            );
          })}
        </div>
      )}
      <div className="task-add" style={{ flexWrap: "wrap" }}>
        <input
          className="q-line"
          type="text"
          maxLength={300}
          placeholder="Add a task…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <input
          className="q-line"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          title="Due date (optional)"
          style={{ maxWidth: 150 }}
        />
        <select
          className="q-line"
          value={assignee}
          onChange={(e) => setAssignee(e.target.value)}
          title="Assign to (optional)"
          style={{ maxWidth: 150 }}
        >
          <option value="">Unassigned</option>
          {Object.entries(ADMIN_NAMES).map(([emailKey, name]) => (
            <option key={emailKey} value={emailKey}>{name}</option>
          ))}
        </select>
        <button className="btn small" type="button" disabled={busy || !text.trim()} onClick={add}>
          Add
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}
