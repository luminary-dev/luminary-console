"use client";

// Marks the link it sits inside while the page that link leads to is still on
// its way. A client tab is a round trip to the server with the old tab left on
// screen until the new one arrives, so without this a click looked like
// nothing had happened for as long as that took.
//
// It wraps the link's own text and adds no box of its own (display: contents
// in globals.css), so nothing moves when it turns on. The styling hangs off
// the attribute: see .subnav-link:has([data-pending]).
import { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

export default function LinkPending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className="link-pending" {...(pending ? { "data-pending": "" } : {})}>
      {children}
    </span>
  );
}
