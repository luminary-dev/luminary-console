// The one tick the console draws: confirmations ("Copied"), finished steps and
// sent states. A line icon in the same stroke as the menu icons, sized to the
// text it sits beside and coloured by it, never a typed ✓ glyph.
export default function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, verticalAlign: "-0.125em" }}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
