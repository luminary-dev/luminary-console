// LC-042: the first tab stop on a console page, so a keyboard user is not
// forced through the topbar on every navigation. Off-canvas until focused
// (.skip-link in app/globals.css). The target needs a matching id and, since
// <main> is not focusable by default, tabIndex={-1} so the jump actually
// moves focus rather than only the scroll position.
export const MAIN_ID = "main-content";

export default function SkipLink({
  targetId = MAIN_ID,
  label = "Skip to content",
}: {
  targetId?: string;
  label?: string;
}) {
  return (
    <a className="skip-link" href={`#${targetId}`}>
      {label}
    </a>
  );
}
