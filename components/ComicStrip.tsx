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
import Image from "next/image";
import { PANELS, PANEL_PX } from "@/lib/comic";

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
          return (
            <li className={`comic-panel is-${panel.size}`} key={panel.file}>
              {/* The frame is the positioning context for the balloons and the
                  container the balloon type scales against, so a line keeps its
                  proportion to the drawing at every width. */}
              <div className="comic-frame" style={{ aspectRatio: `${px.w} / ${px.h}` }}>
                <span className="sr-only">Panel {i + 1}. </span>
                <Image
                  className="comic-img"
                  src={`/comic/${panel.file}`}
                  alt={panel.alt}
                  width={px.w}
                  height={px.h}
                  sizes={panel.size === "wide" ? "(max-width: 960px) 100vw, 920px" : "(max-width: 640px) 100vw, 460px"}
                  // Only the first panel can be near the fold, and only on a
                  // tall screen with both cards hidden. The rest wait until
                  // they are scrolled towards.
                  loading={i === 0 ? "eager" : "lazy"}
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
