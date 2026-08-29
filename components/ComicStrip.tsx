// The strip at the bottom of the hub.
//
// The hub is deliberately sparse: four tiles, and two cards that only appear
// when there is something to say. On a quiet day that leaves a lot of empty
// screen, so this fills it with something worth scrolling to rather than
// another metric nobody asked for.
//
// The panels are WORDLESS by design and the captions below them are real HTML
// text. Image models render lettering as convincing gibberish, so a speech
// bubble would be nonsense at 2x; and text in the markup is selectable,
// translatable, and read aloud by a screen reader, which text baked into a
// JPEG never is.
//
// Regenerate or restyle with `npx tsx scripts/gen-comic.mts`, which holds the
// prompts.
import Image from "next/image";

/** Native size of every panel, so the browser reserves the box before the
 *  image arrives and the page below never jumps. */
const PANEL_W = 1536;
const PANEL_H = 1024;

type Panel = { src: string; alt: string; caption: string };

const PANELS: Panel[] = [
  {
    src: "/comic/01-the-ask.jpg",
    alt: "A client bursts into the workshop with one finger raised while three engineers freeze over their tea.",
    caption: "Four fifty-five on a Friday. The client has one small change.",
  },
  {
    src: "/comic/02-the-look.jpg",
    alt: "The senior engineer sets down her tea and reaches for a large brass dial glowing green.",
    caption: "It is never one small change. She reaches for the dial anyway.",
  },
  {
    src: "/comic/03-the-machine.jpg",
    alt: "The machine erupts: papers everywhere, capsules flying through tubes, a signpost sprouting from a pot.",
    caption: "Estimate, questionnaire, quotation, contract, subdomain. All of it, at once.",
  },
  {
    src: "/comic/04-still-hot.jpg",
    alt: "Stillness. A neat stack of finished documents, the dial dimming, the client mid-blink.",
    caption: "Finished before he finished the sentence. The tea is still hot.",
  },
];

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
          That is survivable here without a redundant role="list", because the
          panel number in each caption is real text and carries the order. */}
      <ol className="comic-strip">
        {PANELS.map((panel, i) => (
          <li className="comic-panel" key={panel.src}>
            <Image
              className="comic-img"
              src={panel.src}
              alt={panel.alt}
              width={PANEL_W}
              height={PANEL_H}
              sizes="(max-width: 720px) 100vw, 720px"
              // The first panel is the only one that can be near the fold, and
              // even that only on a tall screen with both cards hidden.
              // Everything below it waits until it is scrolled towards.
              loading={i === 0 ? "eager" : "lazy"}
            />
            <p className="comic-caption">
              <span className="comic-n">{i + 1}</span>
              {panel.caption}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
