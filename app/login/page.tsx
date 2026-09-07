"use client";

// Two-step sign-in: email + password, then the 6-digit code emailed to that
// address. The pending state lives in an HttpOnly cookie set by the API.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import Illustration from "@/components/Illustration";
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
    // The workshop runs full bleed behind the page; the card floats in the
    // open space the picture leaves on its left. The picture is public (it has
    // to load before anyone has a session: see proxy.ts) and decorative: with
    // it missing this is a card on bone paper, which is the whole page anyway.
    <div className="auth">
      <div className="auth__art" aria-hidden="true">
        <Illustration id="auth-hero" eager sizes="100vw" />
      </div>
      <div className="auth__top">
        <ThemeToggle />
      </div>
      <main className="sheet sheet--auth panel--hero">
      <div className="brand">
        Luminary<span>.</span>
      </div>
      <div className="eyebrow" style={{ marginTop: 10 }}>
        Studio console<span className="no">Sign in</span>
      </div>

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
              className="q-line mono"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              required
              style={{ fontSize: 22, letterSpacing: ".35em" }}
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
      {/* The shop's motto, hand-lettered, the one place the hand face is
          allowed near the interface. Hidden on narrow screens with the rest
          of the decoration. */}
      <p className="bubble bubble--hand bubble--bottom auth__tag" aria-hidden="true">
        Fixed right, or fixed again for free.
      </p>
    </div>
  );
}
