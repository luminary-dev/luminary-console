// Telegram-style circular reveal for theme/accent changes, via the View
// Transitions API: `apply` runs synchronously (mutating <html> attributes),
// then the new look wipes across the page in a growing circle from `origin`.
// Falls back to an instant switch when the API is missing (Firefox) or the
// visitor prefers reduced motion. While the wipe runs, [data-reveal] on <html>
// disables the usual .28s colour transitions so the circle reveals the fully
// recoloured page, not a mid-lerp one.

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => {
    ready: Promise<void>;
    finished: Promise<void>;
  };
};

export function paletteReveal(
  origin: { x: number; y: number },
  apply: () => void,
) {
  const doc = document as ViewTransitionDocument;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || reduce) {
    apply();
    return;
  }

  const { x, y } = origin;
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y),
  );

  const transition = doc.startViewTransition(() => {
    document.documentElement.setAttribute("data-reveal", "");
    apply();
  });
  transition.ready
    .then(() => {
      // Radius LINEAR in time, so the circle's edge — the thing the eye
      // actually tracks — sweeps at a constant speed.
      //
      // Don't "fix" this to radius ∝ √t for a constant-area rate: `origin` is a
      // control near a corner, so most of the circle's area is off-screen, and
      // equalising the circle's area badly front-loads the *visible* coverage.
      // Measured at 1728×906 with the toggle at (1327,35): √t flips 39% of the
      // viewport in the first 100ms and is 81% done by 300ms, leaving 1.5% for
      // the final 100ms — an instant switch followed by nothing. Linear spreads
      // it 8/20/25/23/17/6% per 100ms slice.
      document.documentElement.animate(
        {
          clipPath: [
            `circle(0px at ${x}px ${y}px)`,
            `circle(${radius.toFixed(1)}px at ${x}px ${y}px)`,
          ],
        },
        {
          duration: 600,
          easing: "linear",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    })
    .catch(() => {});
  transition.finished.finally(() =>
    document.documentElement.removeAttribute("data-reveal"),
  );
}

// Centre of the element that triggered the change — a stable wipe origin for
// both mouse and keyboard activation.
export function elementCenter(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Fallback origin for triggers with no on-screen anchor left by the time the
// theme changes — e.g. the command palette, which closes before running.
export function viewportCenter(): { x: number; y: number } {
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
