// In-page probes for the interaction audit.
//
// These run inside the browser via page.evaluate, so they cannot close over
// anything from the Node side and must be self-contained. Each returns plain
// data rather than element handles, because the caller writes it to a report.
//
// One rule throughout: a probe reports what it MEASURED, never what it
// concluded. "This element is 322px wide inside a 360px viewport" survives
// review; "this looks fine" does not.

/** A single element that extends past the viewport's right edge. */
export type OverflowHit = {
  tag: string;
  cls: string;
  id: string;
  text: string;
  right: number;
  width: number;
  /** True when an ancestor scrolls horizontally, which makes this legitimate. */
  insideScroller: boolean;
};

export type OverflowReport = {
  viewportWidth: number;
  documentScrollWidth: number;
  /** How far the page can actually be scrolled sideways. 0 means no overflow. */
  scrollableBy: number;
  hits: OverflowHit[];
};

/**
 * Horizontal overflow, measured two ways because they disagree usefully.
 *
 * `scrollableBy` is the ground truth a person experiences: can the page be
 * dragged sideways. `hits` explains why, and excludes elements living inside a
 * deliberate horizontal scroller, since a wide table inside `overflow-x: auto`
 * is correct rather than broken.
 *
 * The distinction matters: an earlier audit of this repo reported zero
 * overflow from a probe that ran before the scroll containers had mounted, and
 * five real failures went unrecorded for a week. This probe is always called
 * after an explicit settle.
 */
export function overflowProbe(): OverflowReport {
  const de = document.documentElement;
  const vw = de.clientWidth;

  const before = window.scrollX;
  window.scrollTo(9999, window.scrollY);
  const scrollableBy = Math.round(window.scrollX);
  window.scrollTo(before, window.scrollY);

  const hits: OverflowHit[] = [];
  const reported: HTMLElement[] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= vw + 1) continue;

    let ancestor = el.parentElement;
    let insideScroller = false;
    while (ancestor) {
      const s = getComputedStyle(ancestor);
      if (s.overflowX === "auto" || s.overflowX === "scroll" || s.overflowX === "hidden") {
        insideScroller = true;
        break;
      }
      ancestor = ancestor.parentElement;
    }

    // Only the outermost offender per subtree. A too-wide container drags
    // every descendant past the edge with it, and listing all of them buries
    // the one element actually worth fixing.
    if (reported.some((parent) => parent.contains(el))) continue;
    reported.push(el);

    hits.push({
      tag: el.tagName,
      cls: typeof el.className === "string" ? el.className.slice(0, 80) : "",
      id: el.id || "",
      text: (el.textContent || "").trim().slice(0, 50),
      right: Math.round(r.right),
      width: Math.round(r.width),
      insideScroller,
    });
    if (hits.length >= 40) break;
  }

  return {
    viewportWidth: vw,
    documentScrollWidth: de.scrollWidth,
    scrollableBy,
    hits: hits.filter((h) => !h.insideScroller),
  };
}

/** An interactive element and the measurements the audit cares about. */
export type TargetHit = {
  tag: string;
  role: string;
  name: string;
  cls: string;
  width: number;
  height: number;
  /** Nearest neighbour gap in CSS px, or null when it is the only target. */
  nearestGap: number | null;
  disabled: boolean;
  cursor: string;
  /** True when the element is focusable by keyboard. */
  focusable: boolean;
  /** True when opacity is 0 anywhere up the tree: focusable but invisible. */
  invisible: boolean;
};

/**
 * Every interactive element, with its hit box.
 *
 * WCAG 2.2 AA 2.5.8 asks for 24x24 CSS px; Apple's HIG asks 44x44 on touch.
 * `nearestGap` is here because 2.5.8 has a spacing exception: an
 * undersized target can still pass if it is far enough from its neighbours.
 * Reporting the gap means the finding can say which rule actually applies
 * instead of flagging everything small.
 */
export function targetProbe(): TargetHit[] {
  const SELECTOR = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=menuitem]",
    "[role=option]",
    "[role=checkbox]",
    "[role=switch]",
    "[tabindex]",
    "[onclick]",
  ].join(",");

  const els = Array.from(document.querySelectorAll<HTMLElement>(SELECTOR)).filter((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (r.width === 0 || r.height === 0) return false;
    if (s.visibility === "hidden" || s.display === "none") return false;
    // Spam honeypots are deliberately unreachable: parked far off-screen at
    // zero opacity so a bot fills them and a person never sees them. Counting
    // one as an undersized tap target is a false positive, and it showed up
    // as a 4x4 control with a 10041px neighbour gap, which is the giveaway.
    if (Number(s.opacity) === 0) return false;
    if (r.right < 0 || r.bottom < 0 || r.left > window.innerWidth * 3) return false;
    return true;
  });

  // The TARGET is what a finger can hit, which for a control wrapped in a
  // label is the whole label. Measuring the bare <input> reported 20x20
  // checkboxes as failures when their label row is 44px and fully clickable,
  // which is a false positive: WCAG 2.5.8 measures the target, not the widget
  // drawn inside it.
  const targetBox = (el: HTMLElement): DOMRect => {
    const own = el.getBoundingClientRect();
    const label = el.closest("label");
    if (!label || label === el) return own;
    const lb = label.getBoundingClientRect();
    return lb.width >= own.width && lb.height >= own.height ? lb : own;
  };
  const boxes = els.map((el) => targetBox(el));

  const accessibleName = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria.trim().slice(0, 40);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const t = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ")
        .trim();
      if (t) return t.slice(0, 40);
    }
    if (el instanceof HTMLInputElement && el.labels?.length) {
      return (el.labels[0]?.textContent ?? "").trim().slice(0, 40);
    }
    const title = el.getAttribute("title");
    if (title) return title.trim().slice(0, 40);
    return (el.textContent || "").trim().slice(0, 40);
  };

  const opacityZeroAbove = (el: HTMLElement): boolean => {
    let node: HTMLElement | null = el;
    while (node) {
      if (Number(getComputedStyle(node).opacity) === 0) return true;
      node = node.parentElement;
    }
    return false;
  };

  return els.map((el, i) => {
    const r = boxes[i] as DOMRect;
    let nearestGap: number | null = null;
    for (let j = 0; j < boxes.length; j++) {
      if (j === i) continue;
      const o = boxes[j] as DOMRect;
      const dx = Math.max(0, Math.max(r.left - o.right, o.left - r.right));
      const dy = Math.max(0, Math.max(r.top - o.bottom, o.top - r.bottom));
      const gap = Math.round(Math.hypot(dx, dy));
      if (nearestGap === null || gap < nearestGap) nearestGap = gap;
    }
    const s = getComputedStyle(el);
    const tabindex = el.getAttribute("tabindex");
    return {
      tag: el.tagName,
      role: el.getAttribute("role") || "",
      name: accessibleName(el),
      cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
      width: Math.round(r.width),
      height: Math.round(r.height),
      nearestGap,
      disabled: el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true",
      cursor: s.cursor,
      focusable: tabindex !== "-1" && !el.hasAttribute("disabled"),
      invisible: opacityZeroAbove(el),
    };
  });
}

/** Elements whose visibility depends on a hover that touch devices lack. */
export type HoverDependency = {
  selector: string;
  name: string;
  /** The rule text that hides it, for the finding to quote. */
  rule: string;
  focusable: boolean;
};

/**
 * Hover-only affordances.
 *
 * Reads the stylesheets rather than the DOM, because the element is invisible
 * at rest and there is nothing to measure until something hovers it. Any rule
 * combining a `:hover` ancestor with `opacity: 1` on a descendant is the
 * classic row-actions pattern, which disappears entirely on touch.
 */
export function hoverDependencyProbe(): HoverDependency[] {
  const out: HoverDependency[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet, nothing to read
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      const sel = rule.selectorText || "";
      if (!sel.includes(":hover")) continue;
      const decl = rule.style;
      const revealsOpacity = decl.opacity === "1";
      const revealsDisplay = decl.display && decl.display !== "none";
      const revealsVisibility = decl.visibility === "visible";
      if (!revealsOpacity && !revealsDisplay && !revealsVisibility) continue;
      out.push({
        selector: sel.slice(0, 120),
        name: "",
        rule: rule.cssText.slice(0, 160),
        focusable: sel.includes(":focus") || sel.includes("focus-within"),
      });
    }
  }
  return out;
}

/** Hover rules that are not guarded by a hover-capable media query. */
export function stickyHoverProbe(): string[] {
  const out: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list: CSSRuleList, guarded: boolean) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSMediaRule) {
          const q = rule.conditionText || "";
          walk(rule.cssRules, guarded || /hover\s*:\s*hover/.test(q));
          continue;
        }
        if (rule instanceof CSSStyleRule && !guarded && (rule.selectorText || "").includes(":hover")) {
          out.push(rule.selectorText.slice(0, 120));
        }
      }
    };
    walk(rules, false);
  }
  return out;
}

/** Images that were requested and came back as something that is not an image.
 *
 *  This exists because the rest of the harness cannot see this class of bug.
 *  An <img> with width and height reserves its box from the markup alone, so
 *  a panel that 404s or is answered with a login page still lays out to the
 *  exact right size: overflow measures 0, CLS measures 0, the screenshot shows
 *  a tidy blank rectangle, and every assertion passes. The comic strip shipped
 *  through a full green sweep in precisely that state.
 *
 *  `complete && naturalWidth === 0` is the discriminator. A lazy image that
 *  has not been requested yet is `complete === false`, so it is not counted;
 *  an image that finished loading successfully has a non-zero natural width.
 *  Both are correct states, and neither is what this looks for. */
export function brokenImageProbe(): string[] {
  return Array.from(document.images)
    .filter((img) => {
      // An <img> with no src at all is a different defect and not this one.
      const src = img.getAttribute("src");
      if (!src) return false;
      return img.complete && img.naturalWidth === 0;
    })
    .map((img) => (img.currentSrc || img.src || "").slice(0, 160));
}
