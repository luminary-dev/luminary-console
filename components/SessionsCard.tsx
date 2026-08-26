"use client";

// Dashboard "Sessions" card: every signed-in device (from the store-backed
// session registry) with per-session Revoke and a "Sign out everywhere"
// action. Revocation propagates through the proxy's revoked-sid cache within
// ~a minute; revoking your own session also clears the cookie and returns
// you to /login immediately.
import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "./ConfirmDialog";
import { shortWhenLabel } from "@/lib/time";

type Session = { sid: string; email: string; ua: string; at: string; current: boolean };

/** Compact "Chrome · macOS" style label from a user-agent string. */
function device(ua: string): string {
  const browser = /edg\//i.test(ua)
    ? "Edge"
    : /opr\//i.test(ua)
      ? "Opera"
      : /firefox\//i.test(ua)
        ? "Firefox"
        : /chrome\//i.test(ua)
          ? "Chrome"
          : /safari\//i.test(ua)
            ? "Safari"
            : "Browser";
  const os = /iphone|ipad/i.test(ua)
    ? "iOS"
    : /android/i.test(ua)
      ? "Android"
      : /mac os x/i.test(ua)
        ? "macOS"
        : /windows/i.test(ua)
          ? "Windows"
          : /linux/i.test(ua)
            ? "Linux"
            : "Unknown OS";
  return `${browser} · ${os}`;
}

export default function SessionsCard() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async () => {
    const res = await fetch("/api/sessions", { cache: "no-store" }).catch(() => null);
    if (res?.ok) setSessions(await res.json().catch(() => []));
    else setSessions([]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, string>) => {
    setBusy(true);
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (data?.revokedSelf) {
      // Our own cookie may survive the proxy cache for up to a minute —
      // clear it and leave now.
      await fetch("/api/logout", { method: "POST" }).catch(() => {});
      window.location.href = "/login";
      return;
    }
    await load();
    setBusy(false);
  };

  const revoke = async (s: Session) => {
    const ok = await confirm({
      title: s.current ? "Sign out this device?" : "Revoke this session?",
      message: s.current ? (
        <>You&apos;ll be signed out here and returned to the login page.</>
      ) : (
        <>
          <b>{device(s.ua)}</b> ({s.email}, signed in {shortWhenLabel(s.at)}) will be signed out within a
          minute.
        </>
      ),
      confirmLabel: s.current ? "Sign out" : "Revoke",
      danger: true,
    });
    if (ok) await post({ action: "revoke", sid: s.sid });
  };

  const revokeAll = async () => {
    const ok = await confirm({
      title: "Sign out everywhere?",
      message: (
        <>
          Every signed-in device, <b>including this one</b>, is revoked. Everyone signs in again
          with email, password and a fresh code.
        </>
      ),
      confirmLabel: "Sign out everywhere",
      danger: true,
    });
    if (ok) await post({ action: "revokeAll" });
  };

  return (
    <div className="card">
      {dialog}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h3>Sessions</h3>
        {sessions && sessions.length > 0 && (
          <button className="btn ghost small" onClick={revokeAll} disabled={busy}>
            Sign out everywhere
          </button>
        )}
      </div>
      {sessions === null ? (
        <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 13.5 }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ color: "var(--muted)", marginTop: 10, fontSize: 13.5 }}>
          No registered sessions yet: they appear here from the next sign-in.
        </p>
      ) : (
        <div style={{ marginTop: 6 }}>
          {sessions.map((s) => (
            <div
              key={s.sid}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                padding: "10px 0",
                borderTop: "1px solid var(--border)",
              }}
            >
              <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>
                  {device(s.ua)}
                  {s.current && (
                    <span className="pill" style={{ marginLeft: 8 }}>
                      <i />
                      This device
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", overflowWrap: "anywhere" }}>
                  {s.email} · <span className="mono">{shortWhenLabel(s.at)}</span>
                </div>
              </div>
              <button className="btn ghost small" onClick={() => revoke(s)} disabled={busy}>
                {s.current ? "Sign out" : "Revoke"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
