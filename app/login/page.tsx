"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => null);
      setError(data?.error || "Login failed.");
      setBusy(false);
    }
  };

  return (
    <main className="sheet" style={{ maxWidth: 420, marginTop: "18vh" }}>
      <div className="brand" style={{ fontSize: 26 }}>
        Luminary<span>.</span>
      </div>
      <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>Studio console</div>
      <form onSubmit={submit} style={{ marginTop: 28 }}>
        <div className="q-field">
          <span className="q-label">Password</span>
          <input
            className="q-line"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && <div className="form-error">{error}</div>}
        <button className="btn" style={{ marginTop: 22 }} disabled={busy}>
          {busy ? "Checking…" : "Enter console"}
        </button>
      </form>
    </main>
  );
}
