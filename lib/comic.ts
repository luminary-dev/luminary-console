// The console's comic: nine panels, told in dialogue.
//
// One module rather than two, because the last version kept the prompts in a
// script and the display data in a component and the two could drift without
// anything noticing. Here a panel is defined once: `scene` and `size` are what
// scripts/gen-comic.mts draws, `alt` and `bubbles` are what ComicStrip renders.
// Nothing can reference a panel that was never generated.
//
// WHY THE DIALOGUE IS NOT IN THE ARTWORK. Image models letter convincingly and
// incorrectly: across nine panels some lines would come back subtly misspelled,
// and the only repair is to pay to redraw the panel and hope. So the panels are
// drawn wordless with deliberate empty space at the top, and the balloons are
// HTML positioned over them. That text is selectable, translatable, read aloud
// by a screen reader, crisp at any zoom, and editable in a second.
//
// The cost of that choice is coupling: `x`/`y`/`w` are percentages of the panel
// box, chosen against the art. Regenerating a panel can move the clean space,
// so a redraw means re-checking its balloons.

/** A balloon laid over a panel. All units are percentages of the panel box, so
 *  they hold at every width without a media query. */
export type Bubble = {
  /** The line itself. Kept short: a balloon that needs four lines is a script
   *  problem, not a layout problem. */
  text: string;
  /** Who says it. Not rendered; it builds the spoken-dialogue alt text. */
  who: string;
  /** Left and top of the balloon, and its width. */
  x: number;
  y: number;
  w: number;
  /** Which corner the tail leaves from, pointing back at the speaker.
   *  `none` suits a caption box, which nobody is saying. */
  tail: "bl" | "br" | "tl" | "tr" | "none";
  /** `caption` is the narrator's box, `machine` is the Console talking. */
  kind?: "speech" | "caption" | "machine";
};

export type Panel = {
  file: string;
  /** `wide` is 1536x1024 and spans both columns; `square` is 1024x1024 and
   *  takes one. Alternating the two is what stops a comic page reading as a
   *  contact sheet. */
  size: "wide" | "square";
  /** Describes the drawing for anyone who cannot see it. The dialogue is added
   *  separately by the component, so this covers action only. */
  alt: string;
  /** The generation prompt for this panel. */
  scene: string;
  bubbles: Bubble[];
};

export const PANEL_PX = {
  wide: { w: 1536, h: 1024 },
  square: { w: 1024, h: 1024 },
} as const;

/** The widths each panel is pre-encoded to as WebP, by scripts/optimise-comic.mts.
 *
 *  These exist because the comic sits behind the session gate, which rules out
 *  next/image: the optimiser resolves a local image through an internal fetch
 *  that carries no session cookie, so every panel would come back as the login
 *  page. The browser's own request for a plain <img> does carry the cookie. So
 *  the resizing that next/image would have done at runtime is done here ahead
 *  of time instead, and the panels stay private without shipping 1.4MB of JPEG.
 *
 *  Two widths per panel is the whole ladder: a wide panel is never rendered
 *  above 920 CSS px and a square never above 460, so 1536 and 1024 already
 *  cover a 2x display and anything larger would be encoding pixels no screen
 *  will ask for. */
export const VARIANT_WIDTHS: Record<Panel["size"], readonly number[]> = {
  wide: [768, 1536],
  square: [512, 1024],
};

/** The WebP variants of `panel`, smallest first, as `[url, width]` pairs. The
 *  generator writes exactly these paths and the page reads exactly these paths,
 *  so a variant cannot be referenced that was never encoded. */
export function variantsFor(panel: Panel): { url: string; w: number }[] {
  return VARIANT_WIDTHS[panel.size].map((w) => ({
    url: `/comic/${panel.file.replace(/\.jpg$/, `-${w}.webp`)}`,
    w,
  }));
}

/** Every panel asks for a clean top third. It is where balloons go, it is where
 *  the eye starts, and it is the easiest thing for the model to honour. */
const CLEAR_TOP =
  "COMPOSITION: leave the top third of the frame clean, calm and uncluttered, with no important detail in it, so speech balloons can be placed there afterwards.";

export const PANELS: Panel[] = [
  {
    file: "01-friday.jpg",
    size: "wide",
    alt: "Early evening in a bright studio. Three designers pack up for the weekend while a huge dormant machine looms along the back wall.",
    scene: `Early evening in a bright contemporary design studio, tall industrial windows glowing amber. Three young designers are packing up for the weekend: one shrugging on a jacket, one closing a laptop, one stretching with both arms up. Relaxed, happy, end-of-week body language. Along the back wall looms THE CONSOLE, dormant and dark, its enormous dial unlit. ${CLEAR_TOP}`,
    bubbles: [
      { text: "Friday. 4:55 p.m.", who: "Caption", x: 3, y: 6, w: 24, tail: "none", kind: "caption" },
      { text: "We actually made it.", who: "Designer", x: 66, y: 8, w: 30, tail: "bl" },
    ],
  },
  {
    file: "02-the-ask.jpg",
    size: "square",
    alt: "The studio door flies open and a beaming client bursts in mid-stride, clutching a laptop, one finger raised.",
    scene: `The studio door flies open. A cheerful client in a bright jacket bursts in mid-stride clutching a laptop, beaming, one finger raised, radiating the confidence of someone about to say something small. Seen from inside the studio, wind of his entry lifting nearby papers. ${CLEAR_TOP}`,
    bubbles: [{ text: "Tiny change! Two minutes!", who: "Client", x: 46, y: 5, w: 50, tail: "bl" }],
  },
  {
    file: "03-define-tiny.jpg",
    size: "square",
    alt: "Close-up of the lead engineer, mug halfway to her mouth, expression completely flat.",
    scene: `Tight close-up, low angle, of the lead engineer: a young woman with short hair and a well-worn cardigan. She has stopped dead with a coffee mug halfway to her mouth. Her expression is flat, patient and entirely dead behind the eyes. The studio falls away in soft focus behind her. ${CLEAR_TOP}`,
    bubbles: [{ text: "Define tiny.", who: "Lead engineer", x: 4, y: 5, w: 40, tail: "br" }],
  },
  {
    file: "04-the-list.jpg",
    size: "wide",
    alt: "The client stands with both arms flung wide in front of the machine, listing an impossible number of things, while two designers watch with their mugs, unimpressed.",
    scene: `The client, delighted, gesturing expansively at a whiteboard with both arms flung wide, listing an impossible number of things. Two designers stand watching, their faces slowly draining of hope. Comedy of scale: his gestures are enormous, their posture is small. ${CLEAR_TOP}`,
    bubbles: [
      { text: "Bigger logo, a shop, an app. In French.", who: "Client", x: 28, y: 5, w: 46, tail: "bl" },
    ],
  },
  {
    file: "05-the-beat.jpg",
    size: "square",
    alt: "The designers stand frozen and wide-eyed while a coffee mug hangs in mid-air, having just tipped off a desk.",
    scene: `The three designers frozen in place, wide-eyed and absolutely still. In the foreground a coffee mug has just tipped off the edge of a desk and hangs in mid-air, the coffee suspended in a perfect arc. Comic timing: the held beat before disaster. ${CLEAR_TOP}`,
    bubbles: [{ text: "That's four projects.", who: "Designer", x: 6, y: 5, w: 44, tail: "br" }],
  },
  {
    file: "06-the-lever.jpg",
    size: "square",
    alt: "Low angle: the lead engineer's hand closes around a huge brass lever as a vast dial floods the shot with green light.",
    scene: `Dramatic low angle. The lead engineer's hand closes around an enormous brass lever on the Console. Beside it a vast dial floods the shot with lime-green light, throwing hard shadows up the wall. A small, grim, deeply satisfied smile on her underlit face. ${CLEAR_TOP}`,
    bubbles: [{ text: "It's been waiting for this.", who: "Lead engineer", x: 4, y: 5, w: 46, tail: "br" }],
  },
  {
    file: "07-the-machine.jpg",
    size: "wide",
    alt: "The machine erupts: gears spinning, tubes firing capsules, a blizzard of documents, the designers ducking and cheering.",
    scene: `Explosive wide shot of joyful mechanical chaos. THE CONSOLE erupts into motion: gears spinning, pneumatic tubes firing capsules across the ceiling, a blizzard of freshly printed documents fanning through the air, an invoice folding itself in mid-flight, a small signpost-shaped seedling shooting up from a pot on top of the machine. The three designers duck and whoop, delighted. The client is blown backwards, hair flattened. ${CLEAR_TOP}`,
    bubbles: [
      {
        text: "ESTIMATE. CONTRACT. INVOICE. DEPLOYED.",
        who: "The Console",
        x: 20, y: 5, w: 60, tail: "bl", kind: "machine",
      },
    ],
  },
  {
    file: "08-still-hot.jpg",
    size: "square",
    alt: "Sudden stillness. A tall neat stack of finished documents, and a brass mechanical arm holding out the rescued mug, still steaming, while the client stands mid-sentence with one finger raised.",
    scene: `Sudden total stillness. A single sheet of paper drifts down onto a perfectly squared stack of finished documents. The Console sits innocent, its green dial dimming. A slender mechanical arm has caught the falling coffee mug and holds it out, unspilled, steam still rising. The client stands blinking, finger still raised, having never finished his sentence. ${CLEAR_TOP}`,
    bubbles: [{ text: "...and maybe a newsletter?", who: "Client", x: 38, y: 5, w: 56, tail: "bl" }],
  },
  {
    file: "09-last-tuesday.jpg",
    size: "square",
    alt: "The client has gone pale at a long receipt pooling on the floor. The engineer sips her coffee. The machine's dial has narrowed to a smug sliver.",
    scene: `The client has gone pale, staring down at a long printed receipt unspooling from the machine and pooling in coils on the floor. The lead engineer sips her coffee, entirely calm, not looking at him. On the Console the great green dial has narrowed to a smug, knowing sliver of light, almost a half-closed eye. Slightly ominous and very funny. COMPOSITION: leave the top third and the lower right of the frame clean and uncluttered.`,
    bubbles: [
      { text: "It sent that. Last Tuesday.", who: "Lead engineer", x: 3, y: 5, w: 44, tail: "br" },
      { text: "You're welcome.", who: "The Console", x: 58, y: 72, w: 38, tail: "tl", kind: "machine" },
    ],
  },
];
