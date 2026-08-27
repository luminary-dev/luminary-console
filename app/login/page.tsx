"use client";

// Two-step sign-in: email + password, then the 6-digit code emailed to that
// address. The pending state lives in an HttpOnly cookie set by the API.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "@/components/ThemeToggle";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"creds" | "otp">("creds");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timedOut = typeof window !== "undefined" && window.location.search.includes("timedout");
  const router = useRouter();
  // The code field carries a hint alongside its label, so it is associated
  // explicitly: an implicit label would fold the hint into the accessible name.
  const codeId = useId();
  const codeHintId = useId();

  const post = async (body: Record<string, string>) => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.error || "Login failed.");
      return null;
    }
    return data;
  };

  const submitCreds = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await post({ email, password });
    if (data?.step === "otp") {
      setStep("otp");
      setNote(data.note || `We emailed a 6-digit code to ${email}.`);
      setCode("");
    }
  };

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = await post({ code });
    if (data?.ok) {
      router.push("/");
      router.refresh();
    }
  };

  return (
    <main className="sheet sheet--auth">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <ThemeToggle />
      </div>
      <div className="brand" style={{ fontSize: 26 }}>
        Luminary<span>.</span>
      </div>
      <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>Studio console</div>

      {timedOut && step === "creds" && (
        <div className="notice" style={{ marginTop: 18 }}>You were signed out after 30 minutes of inactivity.</div>
      )}
      {step === "creds" ? (
        <form onSubmit={submitCreds} style={{ marginTop: 28 }}>
          <label className="q-field">
            <span className="q-label">Email</span>
            <input
              className="q-line"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </label>
          <label className="q-field">
            <span className="q-label">Password</span>
            <input
              className="q-line"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn" style={{ marginTop: 22 }} disabled={busy}>
            {busy ? "Checking…" : "Continue"}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} style={{ marginTop: 28 }}>
          <div className="q-field">
            <label className="q-label" htmlFor={codeId}>Enter the 6-digit code</label>
            {note && <div className="q-hint" id={codeHintId}>{note} It expires in 10 minutes.</div>}
            <input
              id={codeId}
              aria-describedby={note ? codeHintId : undefined}
              className="q-line"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
              style={{ fontSize: 22, letterSpacing: ".35em", fontFamily: "var(--mono)" }}
            />
          </div>
          {error && <div className="form-error">{error}</div>}
          <button className="btn" style={{ marginTop: 22 }} disabled={busy || code.length !== 6}>
            {busy ? "Checking…" : "Sign in"}
          </button>
          <button
            type="button"
            className="btn ghost small"
            style={{ marginTop: 12, marginLeft: 10 }}
            disabled={busy}
            onClick={() => { setStep("creds"); setError(null); }}
          >
            ← Start over / resend
          </button>
        </form>
      )}
    </main>
  );
}
