"use client";

// A button that copies a block of text and says so. Clipboard access can be
// refused (an insecure context, a permission prompt dismissed), and then the
// label says that instead of claiming a copy that did not happen.
import { useEffect, useRef, useState } from "react";

export default function CopyText({
  text,
  label = "Copy",
  className = "btn ghost small",
  onCopied,
}: {
  text: string;
  label?: string;
  className?: string;
  onCopied?: () => void;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      ok = false;
    }
    setState(ok ? "copied" : "failed");
    if (ok) onCopied?.();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1800);
  };

  return (
    <button type="button" className={className} onClick={copy}>
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : label}
      </span>
    </button>
  );
}
