"use client";

export default function SignOut() {
  return (
    <button
      className="btn ghost small"
      onClick={async () => {
        await fetch("/api/logout", { method: "POST" }).catch(() => {});
        window.location.href = "/login";
      }}
    >
      Sign out
    </button>
  );
}
