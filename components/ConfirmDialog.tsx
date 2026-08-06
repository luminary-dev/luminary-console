"use client";

// Themed replacement for window.confirm / window.prompt: useConfirm() gives a
// promise-based confirm() plus a `dialog` node to render once in the
// component. Resolves null on cancel; "yes" on confirm; the typed value when
// `password` (client deletion re-auth) or `prompt` (free-text, e.g. a payment
// amount) is set.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ConfirmOptions = {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  password?: boolean;
  /** Free-text input; resolves with the typed value. `initial` prefills it. */
  prompt?: { placeholder?: string; initial?: string };
};

export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [pw, setPw] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    setPw(o.prompt?.initial ?? "");
    setOpts(o);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  // opts is always null during SSR, so the portal only runs in the browser.
  const dialog = opts
    ? createPortal(
        <div className="modal-veil" onMouseDown={() => close(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label={opts.title}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h4 className={`modal-title${opts.danger ? " danger" : ""}`}>{opts.title}</h4>
            <div className="modal-body">{opts.message}</div>
            {(opts.password || opts.prompt) && (
              <input
                className="q-line"
                type={opts.password ? "password" : "text"}
                placeholder={opts.password ? "Console password" : opts.prompt?.placeholder}
                autoFocus
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && pw.trim()) close(pw);
                }}
                style={{ width: "100%", marginTop: 4 }}
              />
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost small" onClick={() => close(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn small${opts.danger ? " btn-danger" : ""}`}
                autoFocus={!opts.password && !opts.prompt}
                disabled={opts.password || opts.prompt ? pw.trim().length === 0 : false}
                onClick={() => close(opts.password || opts.prompt ? pw : "yes")}
              >
                {opts.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return { confirm, dialog };
}
