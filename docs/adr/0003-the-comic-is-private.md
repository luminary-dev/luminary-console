# 3. The hub comic is private, which rules out next/image for it

Date: 2026-08-29

## Status

Accepted.

## Context

The hub carries a nine-panel comic about the studio. It contains no client
data: it is drawn artwork and invented dialogue about an invented client.

The first implementation used `next/image`, which is the obvious choice and
gives WebP negotiation, a generated `srcset` and lazy loading for free. That
implementation did not work, and the way it failed is the substance of this
decision.

`next/image` does not read a local file from disk. It resolves the path
through an internal HTTP request back to the app, and **that request does not
carry the visitor's session cookie**. The console's proxy gates every path
that is not on an explicit allowlist of public assets. So the optimiser asked
for `/comic/01-friday.jpg`, the gate answered with the `/login` HTML, and the
optimiser reported the panel as not-an-image and returned `400`.

Nothing failed visibly. An `<img>` carrying `width` and `height` reserves its
box from markup alone, so the geometry was identical to a working page: no
overflow, no layout shift, a tidy blank rectangle in every screenshot. A full
sweep passed with all nine panels blank. That is recorded as IX-013.

The immediate fix was to add `/comic/` to the proxy's public allowlist. It
worked, and it meant the artwork was readable by anyone with the URL, signed
in or not. That is the question this ADR settles.

## Decision

The comic stays **behind the session gate**, like every other path in the
console. A signed-out request for a panel gets `/login`, exactly as a request
for a client record would.

Because of that, the comic does not use `next/image`. It uses a plain `<img>`
with an explicit `srcSet` over WebP variants that are **pre-encoded at
authoring time** by `scripts/optimise-comic.mts` and committed alongside the
JPEG masters. The browser fetches the panel itself, so the request carries the
cookie and passes the gate, and the optimiser is never in the path.

Two widths per panel, chosen against how the page actually renders: a wide
panel is never displayed above 920 CSS px and a square never above 460, so
1536 and 1024 already cover a 2x display.

## Consequences

The resizing work moves from request time to authoring time. A redrawn panel
now needs `scripts/optimise-comic.mts` run against it, which is a step someone
will eventually forget. Two things catch that: the JPEG masters are committed
so re-encoding never requires paying to redraw, and `brokenImageProbe()` in
the interaction harness fails the build if a referenced variant is missing,
because a missing variant is exactly the silent blank-panel failure above.

The bandwidth is comparable to what the optimiser was producing. Measured on
the built page: 543KB across nine panels at 1280px, 310KB at 390px, against
1.4MB of unprocessed JPEG.

`sharp` becomes a declared devDependency. It was already installed as a
transitive dependency of `next`; a script that imports a package nobody
depends on breaks silently the day the parent stops shipping it.

The gate is now a property under test rather than an assumption.
`tests/interaction/gating.spec.ts` runs in the only harness project that
carries no session, and asserts that all 27 comic files answer `307` to a
stranger while `/manifest.webmanifest`, `/icon.svg` and `/sw.js` still answer
`200`. Both halves matter: without the second, a change that gated everything
would pass while breaking the installed PWA, whose service worker and manifest
are fetched signed-out by design. Verified by re-adding the exemption and
watching the test fail.

Nothing here argues the artwork is sensitive. The argument is that "this
particular asset is harmless" is a judgement that has to be re-made correctly
every time someone adds a file to that directory, and defaulting to private
means getting it wrong costs a `307` rather than a leak.
