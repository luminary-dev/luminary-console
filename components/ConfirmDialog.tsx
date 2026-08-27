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
//
// The trap, the background scroll lock and the focus return all live in
// useOverlayBehaviour, shared with the command palette (IX-004, IX-005,
// IX-006). The trap this file used to carry only intervened at the edges of a
// focusable list it rebuilt from a selector that still counted tabindex="-1"
// nodes, which left the browser's own tab order in charge everywhere else.
import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useOverlayBehaviour } from "./useOverlayBehaviour";

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
  const uid = useId();
  const titleId = `${uid}-title`;
  const bodyId = `${uid}-body`;
  const inputId = `${uid}-input`;

  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [pw, setPw] = useState("");
  const resolver = useRef<((v: string | null) => void) | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const close = useCallback((v: string | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  }, []);

  const dismiss = useCallback(() => close(null), [close]);

  // Focus trap, scroll lock, Escape and focus return, all shared with the
  // command palette.
  const { captureTrigger } = useOverlayBehaviour({
    open: opts !== null,
    overlayRef: modalRef,
    onDismiss: dismiss,
  });

  const confirm = useCallback(
    (o: ConfirmOptions) => {
      // Synchronously, before the dialog renders and its autoFocus fires.
      captureTrigger();
      setPw(o.prompt?.initial ?? "");
      setOpts(o);
      return new Promise<string | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    [captureTrigger],
  );

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
