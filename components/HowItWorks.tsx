// The detail behind a screen or a card, folded away until someone wants it.
//
// The console explains itself well, but it did so in full, on every screen,
// every time: where a number is read from, which setting is missing, what the
// rule behind a button is. Someone using a screen for the hundredth time read
// past it, and someone new could not tell the one sentence they needed from
// the five written for whoever maintains the code. The sentence a newcomer
// needs now stands on its own, and the rest is one click away here.
//
// A native <details>: it works without script and a screen reader announces
// it as a control that expands.
import type { ReactNode } from "react";

export default function HowItWorks({
  label = "How this works",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  return (
    <details className="how">
      <summary>{label}</summary>
      <div className="how-body">{children}</div>
    </details>
  );
}
