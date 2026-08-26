"use client";

// Private operator notes with a debounced autosave. No Save button on
// purpose: notes get typed mid-call, and a button you forget to press is
// worse than no notes at all. The state line is the whole affordance.
import { useCallback, useEffect, useRef, useState } from "react";
import { opsFetch } from "@/lib/ops-fetch";

const DEBOUNCE_MS = 800;

export default function NotesCard({ slug, notes }: { slug: string; notes?: string }) {
  const [value, setValue] = useState(notes ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // What the server is known to hold — a save is only worth making when the
  // text has actually moved on from it.
  const saved = useRef(notes ?? "");

  const save = useCallback(
    async (text: string) => {
      if (text === saved.current) return;
      setState("saving");
      const res = await opsFetch(`/api/clients/${slug}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: text }),
      }).catch(() => null);
      if (res?.ok) {
        saved.current = text;
        setState("saved");
      } else {
        setState("error");
      }
    },
    [slug],
  );

  const onChange = (text: string) => {
    setValue(text);
    setState("idle");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(text), DEBOUNCE_MS);
  };

  // Leaving the field shouldn't wait out the debounce, and neither should
  // navigating away mid-sentence.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    save(value);
  }, [save, value]);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved: retry" : "";

  return (
    <div className="card">
      <div className="ask-head">
        <h3>Notes</h3>
        <span className={`save-state${state === "saved" ? " on" : ""}`}>{label}</span>
      </div>
      <p className="empty-note" style={{ marginTop: 4 }}>
        Private to the console: never shown to the client, never sent anywhere.
      </p>
      <textarea
        className="q-box"
        rows={5}
        style={{ width: "100%", marginTop: 12 }}
        placeholder="Call notes, decisions, things to chase…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={flush}
      />
      {state === "error" && (
        <div className="form-error">
          That didn&apos;t save. Keep the text here, check your connection and click away from the
          box to try again.
        </div>
      )}
    </div>
  );
}
