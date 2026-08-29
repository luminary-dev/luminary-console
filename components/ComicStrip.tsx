// The comic at the bottom of the hub.
//
// The hub is deliberately sparse: four tiles, and two cards that appear only
// when there is something to say. On a quiet day that leaves a lot of empty
// screen, so this fills it with something worth scrolling to rather than
// another metric nobody asked for.
//
// Panels, dialogue and balloon positions all live in lib/comic.ts. This file
// is only the rendering: a two-column comic page where the wide panels span
// both columns, collapsing to one column on narrow screens.
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
import { PANELS, PANEL_PX, variantsFor } from "@/lib/comic";

export default function ComicStrip() {
  return (
    <section className="comic" aria-labelledby="comic-title">
      <div className="comic-head">
        <h2 className="comic-title" id="comic-title">
          One small change
        </h2>
        <p className="comic-sub">A short and only slightly exaggerated history of this console.</p>
      </div>

      {/* Safari drops list semantics from any list styled `list-style: none`.
          Survivable without a redundant role="list": each panel is numbered in
          text for a screen reader, which carries the reading order. */}
      <ol className="comic-page">
        {PANELS.map((panel, i) => {
          const px = PANEL_PX[panel.size];
          const variants = variantsFor(panel);
          // Largest last, and used as the plain src: it is the fallback for
          // anything that ignores srcSet, so it should be the good one.
          const fallback = variants[variants.length - 1]!;
          return (
            <li className={`comic-panel is-${panel.size}`} key={panel.file}>
              {/* The frame is the positioning context for the balloons and the
                  container the balloon type scales against, so a line keeps its
                  proportion to the drawing at every width. */}
              <div className="comic-frame" style={{ aspectRatio: `${px.w} / ${px.h}` }}>
                <span className="sr-only">Panel {i + 1}. </span>
                {/* A bare <img> on purpose. See the note at the top of this
                    file: next/image cannot reach a gated asset, so the
                    variants are pre-encoded and selected here instead. */}
                <img
                  className="comic-img"
                  src={fallback.url}
                  srcSet={variants.map((v) => `${v.url} ${v.w}w`).join(", ")}
                  sizes={
                    panel.size === "wide"
                      ? "(max-width: 960px) 100vw, 920px"
                      : "(max-width: 640px) 100vw, 460px"
                  }
                  alt={panel.alt}
                  // The intrinsic size, so the box is reserved before the file
                  // arrives and nothing below the comic moves when it does.
                  width={px.w}
                  height={px.h}
                  // Only the first panel can be near the fold, and only on a
                  // tall screen with both cards hidden. The rest wait until
                  // they are scrolled towards.
                  loading={i === 0 ? "eager" : "lazy"}
                  decoding="async"
                />
                {panel.bubbles.map((bubble, j) => (
                  <p
                    className={`comic-bubble is-${bubble.kind ?? "speech"} tail-${bubble.tail}`}
                    key={`${panel.file}-${j}`}
                    style={{ left: `${bubble.x}%`, top: `${bubble.y}%`, width: `${bubble.w}%` }}
                  >
                    {/* Who is speaking is obvious in the drawing and invisible
                        to a screen reader, so it is supplied in text. */}
                    <span className="sr-only">{bubble.who}: </span>
                    {bubble.text}
                  </p>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
