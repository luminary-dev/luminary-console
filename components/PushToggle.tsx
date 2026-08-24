"use client";

// Per-device push notifications for the installed console app.
//
// Renders as one topbar button with three personalities:
//   - Push supported here (installed iOS app, desktop browser): an on/off
//     toggle that (un)registers this device with /api/push. Subscribing fires
//     a test notice so the operator sees delivery work end to end.
//   - iOS Safari in the browser tab (no PushManager until the app is on the
//     home screen): an "Get the app" hint with install steps.
//   - Anything else unsupported, or VAPID keys not configured: renders nothing.
import { useEffect, useRef, useState } from "react";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = window.atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const standalone = window.matchMedia("(display-mode: standalone)").matches;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac/.test(ua)
          ? "Mac"
          : "Desktop";
  return standalone ? `${device} app` : device;
}

type Mode = "hidden" | "toggle" | "install-hint";

export default function PushToggle() {
  const [mode, setMode] = useState<Mode>("hidden");
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const publicKey = useRef<string | null>(null);

  useEffect(() => {
    const supported =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches;

    (async () => {
      if (!supported) {
        // iOS exposes PushManager only to home-screen apps — nudge the install.
        if (isIOS && !standalone) setMode("install-hint");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none",
        });
        const res = await fetch("/api/push", { cache: "no-store" });
        const info = res.ok ? await res.json() : null;
        if (!info?.configured) return; // VAPID keys not set — nothing to offer
        publicKey.current = info.publicKey;
        const sub = await registration.pushManager.getSubscription();
        setEnabled(Boolean(sub) && Notification.permission === "granted");
        setMode("toggle");
      } catch {
        // registration/config fetch failed — leave the button hidden
      }
    })();
  }, []);

  async function turnOn() {
    if (!publicKey.current) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return;
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey.current),
        }));
      const serialized = JSON.parse(JSON.stringify(sub));
      const saved = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: serialized, device: deviceLabel() }),
      });
      if (!saved.ok) throw new Error("save failed");
      setEnabled(true);
      // Prove the whole pipeline (VAPID → push service → this device) works.
      fetch("/api/push/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      }).catch(() => {});
    } catch (e) {
      console.error("Push subscribe failed:", e);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
      setEnabled(false);
    } finally {
      setBusy(false);
    }
  }

  if (mode === "hidden") return null;

  if (mode === "install-hint") {
    return (
      <span style={{ position: "relative" }}>
        <button className="btn ghost small" onClick={() => setHintOpen((o) => !o)}>
          Get the app
        </button>
        {hintOpen && (
          <span
            className="card"
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              zIndex: 30,
              width: 260,
              display: "block",
              fontSize: 13,
              lineHeight: 1.5,
              margin: 0,
              boxShadow: "0 8px 28px rgba(0,0,0,.18)",
            }}
          >
            <b>Install Luminary on this iPhone</b>
            <span style={{ display: "block", color: "var(--muted)", marginTop: 6 }}>
              In Safari: tap <b>Share</b>, then <b>Add to Home Screen</b>. Open the app from the
              home screen and this button becomes a notifications toggle.
            </span>
          </span>
        )}
      </span>
    );
  }

  return (
    <button
      className="btn ghost small"
      disabled={busy}
      onClick={enabled ? turnOff : turnOn}
      title={
        enabled
          ? "This device gets studio notifications — tap to turn off"
          : "Get studio notifications on this device"
      }
    >
      {enabled ? "Alerts: on" : "Alerts: off"}
    </button>
  );
}
