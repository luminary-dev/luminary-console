"use client";

// Themed replacement for window.confirm / window.prompt: useConfirm() gives a
// promise-based confirm() plus a `dialog` node to render once in the
// component. Resolves null on cancel; "yes" on confirm; the typed value when
// `password` (client deletion re-auth) or `prompt` (free-text, e.g. a payment
// amount) is set.
//
// Accessibility (LC-043): Tab is trapped inside the open dialog, focus goes
// back to whatever opened it on close, and the veil dismisses through a real
// button rather than a mouse handler on a non-interactive div.
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
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

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export function useConfirm() {
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const inputId = `${uid}-input`;

  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [pw, setPw] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  /** Whatever had focus when confirm() was called, so it can be handed back. */
  const trigger = useRef<HTMLElement | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  // Escape closes; Tab is trapped. The trap lives on the window rather than
  // on the dialog node so it also pulls focus back in when it has already
  // escaped into the page behind the veil.
  useEffect(() => {
    if (!opts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close(null); return; }
      if (e.key !== "Tab") return;
      const root = modalRef.current;
      if (!root) return;
      const stops = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const here = document.activeElement;
      const leaving = e.shiftKey ? here === first || !root.contains(here) : here === last || !root.contains(here);
      if (leaving) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [opts, close]);

  // Runs after the portal has unmounted, so React cannot pull focus back to
  // the body afterwards. No-op on first mount, where nothing was stored.
  useEffect(() => {
    if (opts) return;
    const el = trigger.current;
    trigger.current = null;
    el?.focus();
  }, [opts]);

  const needsInput = Boolean(opts?.password || opts?.prompt);

  // opts is always null during SSR, so the portal only runs in the browser.
  const dialog = opts
    ? createPortal(
        <div className="modal-veil">
          <button
            type="button"
            className="modal-veil-btn"
            aria-hidden="true"
            tabIndex={-1}
            onClick={() => close(null)}
          />
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={bodyId}
            ref={modalRef}
          >
            <h4 id={titleId} className={`modal-title${opts.danger ? " danger" : ""}`}>{opts.title}</h4>
            <div id={bodyId} className="modal-body">{opts.message}</div>
            {needsInput && (
              <>
                <label className="sr-only" htmlFor={inputId}>
                  {opts.password ? "Console password" : opts.prompt?.placeholder ?? opts.title}
                </label>
                <input
                  id={inputId}
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
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="btn ghost small" onClick={() => close(null)}>
                Cancel
              </button>
              <button
                type="button"
                className={`btn small${opts.danger ? " btn-danger" : ""}`}
                autoFocus={!needsInput}
                disabled={needsInput ? pw.trim().length === 0 : false}
                onClick={() => close(needsInput ? pw : "yes")}
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
