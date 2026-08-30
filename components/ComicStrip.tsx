// The comic at the bottom of the hub.
//
// The hub is deliberately sparse: four tiles, and two cards that appear only
// when there is something to say. On a quiet day that leaves a lot of empty
// screen, so this fills it with something worth scrolling to rather than
// another metric nobody asked for.
//
// Panels, dialogue and balloon positions all live in lib/comic.ts. This file
// is only the rendering: two rows of equal-shaped panels, four then five,
// shown on wide landscape screens and hidden everywhere else.
//
// The balloons are HTML laid over the artwork, not lettering baked into it.
// lib/comic.ts explains that decision; the consequence here is that a balloon
// is real text, so it is selectable, translatable, announced by a screen
// reader in reading order after its panel's description, and stays sharp when
// the page is zoomed to 400 percent.
//
// A plain <img> rather than next/image, and that is deliberate. The comic sits
// behind the session gate like the rest of the console, and the image
// optimiser resolves a local path through an internal fetch that carries no
// session cookie, so every panel comes back as the login page: verified, and
// it fails silently because width and height reserve the box whatever arrives.
// The browser's own request does carry the cookie. The resizing the optimiser
// would have done is done ahead of time by scripts/optimise-comic.mts instead,
// which is what `srcSet` below is selecting from.
import { PANELS, PANEL_PX, DISPLAY_ASPECT, rowsOfPanels, variantsFor } from "@/lib/comic";

/** Panel numbers for screen readers, taken from story order rather than from
 *  position in a row, so they stay 1..9 across the row break. */
const PANEL_NUMBER = new Map(PANELS.map((p, i) => [p.file, i + 1]));

export default function ComicStrip() {
  return (
    <section className="comic" aria-labelledby="comic-title">
      {/* No visible title or standfirst: the comic introduces itself, and a
          heading over it made the hub look like it had another section of work
          in it. The heading survives for the document outline and for anyone
          navigating by headings, who otherwise arrives at nine unexplained
          images. */}
      <h2 className="sr-only" id="comic-title">
        One small change: a short and only slightly exaggerated history of this console
      </h2>

      {/* Two rows, declared in lib/comic.ts. Each is its own grid, because the
          rows hold different numbers of panels and every panel is displayed at
          the same 3:2 shape, so a row is simply N equal columns.

          A list per row rather than one list with row wrappers inside it: an
          <ol> may only contain <li>, and a <div> in between is both invalid
          and an axe `list` failure. Splitting the numbering across two lists
          costs nothing here because each panel announces its own number. */}
      <div className="comic-page">
        {rowsOfPanels().map((row, r) => (
          <ol
            className="comic-row"
            key={`row-${r}`}
            style={{ gridTemplateColumns: `repeat(${row.length}, 1fr)` }}
          >
            {row.map((panel) => {
              const px = PANEL_PX[panel.size];
              const variants = variantsFor(panel);
              // Largest last, and used as the plain src: it is the fallback
              // for anything that ignores srcSet, so it should be the good one.
              const fallback = variants[variants.length - 1]!;
              const n = PANEL_NUMBER.get(panel.file)!;
              return (
                <li className="comic-panel" key={panel.file}>
                  {/* The frame is the positioning context for the balloons and
                      the container the balloon type scales against, so a line
                      keeps its proportion to the drawing at every width. It
                      also imposes the 3:2 crop. */}
                  <div className="comic-frame" style={{ aspectRatio: DISPLAY_ASPECT }}>
                    <span className="sr-only">Panel {n}. </span>
                    {/* A bare <img> on purpose. See the note at the top of this
                        file: next/image cannot reach a gated asset, so the
                        variants are pre-encoded and selected here instead. */}
                    <img
                      className="comic-img"
                      src={fallback.url}
                      srcSet={variants.map((v) => `${v.url} ${v.w}w`).join(", ")}
                      sizes={`${Math.round(100 / row.length)}vw`}
                      alt={panel.alt}
                      // The intrinsic size, so the box is reserved before the
                      // file arrives and nothing below the comic moves.
                      width={px.w}
                      height={px.h}
                      // Every panel, including the first. The comic only
                      // renders on wide landscape screens and sits below the
                      // fold even there, and where it is hidden the markup is
                      // still served: lazy is what stops a phone paying for
                      // artwork it will never be shown.
                      loading="lazy"
                      decoding="async"
                      {...(panel.focus ? { style: { objectPosition: panel.focus } } : {})}
                    />
                    {panel.bubbles.map((bubble, j) => (
                      <p
                        className={`comic-bubble is-${bubble.kind ?? "speech"} tail-${bubble.tail}`}
                        key={`${panel.file}-${j}`}
                        style={{ left: `${bubble.x}%`, top: `${bubble.y}%`, width: `${bubble.w}%` }}
                      >
                        {/* Who is speaking is obvious in the drawing and
                            invisible to a screen reader, so it is in text. */}
                        <span className="sr-only">{bubble.who}: </span>
                        {bubble.text}
                      </p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ol>
        ))}
      </div>
    </section>
  );
}
