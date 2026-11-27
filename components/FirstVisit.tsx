"use client";

// A short welcome on Today for someone who has not seen the console before:
// what the four parts of the menu are, and where Help is.
//
// It is remembered as dismissed in this browser only. That is a convenience,
// not a record: clearing the browser brings it back once, which costs one
// click. It starts hidden and appears after the page loads, so the server and
// the browser agree on the first paint and a returning visitor never sees it
// flash.
import Link from "next/link";
import { useEffect, useState } from "react";
import { HELP, MENU } from "@/lib/menu";

const KEY = "luminary-welcome-seen";

export default function FirstVisit() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(KEY)) setShow(true);
    } catch {
      // Storage is blocked (a private window): say nothing rather than
      // welcome the same person on every visit.
    }
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      // Not remembered; it will offer itself again next time.
    }
  };

  return (
    <section className="card welcome" aria-labelledby="welcome-title">
      <h3 id="welcome-title">New here? The menu is the whole console.</h3>
      <dl className="welcome-list">
        {MENU.map((group) => (
          <div key={group.id}>
            <dt>{group.label}</dt>
            <dd>{group.what}</dd>
          </div>
        ))}
      </dl>
      <p className="empty-note">
        This page, Today, lists what is waiting on you. Search finds any screen or client by name.
      </p>
      <div className="welcome-actions">
        <Link className="btn small" href={HELP.href} onClick={dismiss}>
          See what every screen is for
        </Link>
        <button type="button" className="btn ghost small" onClick={dismiss}>
          Got it
        </button>
      </div>
    </section>
  );
}
