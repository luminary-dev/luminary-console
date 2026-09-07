// One generated picture, in whichever palette the page is wearing.
//
// Two <img>s, one per mode, and the theme attribute on <html> shows one and
// hides the other (.illo--light / .illo--dark in app/globals.css). That keeps
// the swap a pure style change: no client component, no hydration mismatch,
// no flash of the wrong picture on a server render that already knows the
// theme from the cookie. A hidden lazy image is never fetched, so a visitor
// downloads one file, not two.
//
// A plain <img> rather than next/image, deliberately. The console gates every
// path that is not on proxy.ts's public list, and the image optimiser fetches
// a local file through an internal request that carries no session cookie, so
// it would receive the login page instead of the picture. The variants it
// would have produced are pre-encoded by scripts/generate-illustrations.ts
// and selected here through srcSet. docs/adr/0003-the-comic-is-private.md is
// the same decision for the hub comic.
//
// width and height are the intrinsic size, so the box is reserved before the
// file arrives and nothing beneath the picture moves. Every use sits inside a
// frame that sets the display size and crops with object-fit, so the
// intrinsic ratio never dictates layout: with the file missing the frame is a
// plain tinted band and the page is complete without it.
import { imageProps, type IllustrationId } from "@/lib/illustrations/assets";

export default function Illustration({
  id,
  className,
  sizes = "(max-width: 1112px) 100vw, 1080px",
  eager = false,
  alt,
}: {
  id: IllustrationId;
  className?: string;
  /** The sizes attribute, so the browser picks the 768 or 1536 variant. */
  sizes?: string;
  /** Above the fold on a page with nothing else to paint (the sign-in
   *  backdrop). Everything else is lazy. */
  eager?: boolean;
  /** Overrides the manifest's alt, for a spot picture used as content. */
  alt?: string;
}) {
  const light = imageProps(id, "light");
  const dark = imageProps(id, "dark");
  const loading = eager ? "eager" : "lazy";
  const fetchPriority = eager ? "high" : "auto";
  const cls = className ? ` ${className}` : "";
  const text = alt ?? light.alt;
  return (
    <>
      <img
        className={`illo illo--light${cls}`}
        src={light.src}
        srcSet={light.srcSet}
        sizes={sizes}
        width={light.width}
        height={light.height}
        alt={text}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
      />
      <img
        className={`illo illo--dark${cls}`}
        src={dark.src}
        srcSet={dark.srcSet}
        sizes={sizes}
        width={dark.width}
        height={dark.height}
        alt={text}
        loading={loading}
        decoding="async"
        fetchPriority={fetchPriority}
      />
    </>
  );
}
