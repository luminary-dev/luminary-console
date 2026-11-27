"use client";

// The social kit as a posting list for the team: every post in order, its
// caption to copy, its pictures to download, and a tick per platform that
// everyone shares. The ticks are the reason this lives in the console: the
// kit site shows the posts, but only the console knows which are already up.
//
// The kit runs to 50+ posts, so the page is not one long scroll: "Next up"
// shows the next posting day's posts in full (what you need today), and the
// rest sit in one folding section per week, as compact rows that open into
// the same full card.
import { useMemo, useState } from "react";
import CheckIcon from "@/components/CheckIcon";
import { displayName } from "@/lib/admins";
import { CHANNELS, CHANNEL_LABEL, kitFileHref, type Kit, type KitChannel, type KitPost, type PostedMap } from "@/lib/kit";
import RelativeTime from "@/components/RelativeTime";
import CopyText from "./CopyText";

type Show = "todo" | "done" | "all";

const weekOf = (day: number) => Math.ceil(day / 7);

const isDone = (posted: PostedMap, id: string) => CHANNELS.every((c) => posted[id]?.[c]);

type CardProps = {
  post: KitPost;
  marks: PostedMap[string] | undefined;
  busy: boolean;
  toggle: (id: string, channel: KitChannel, posted: boolean) => void;
};

function PostCard({ post, marks, busy, toggle, anchor }: CardProps & { anchor?: boolean }) {
  const many = post.files.length > 1;
  return (
    <div className="kit-post" id={anchor ? `post-${post.id}` : undefined}>
      <div className={`kit-pics${many ? " is-many" : ""}`}>
        {post.files.map((f, i) => (
          // Plain <img>: these come through the console's own route, and
          // next/image would re-encode pictures whose text has to stay sharp.
          <img
            key={f}
            src={kitFileHref(f)}
            alt={i === 0 ? post.alt : `${post.title}, picture ${i + 1} of ${post.files.length}`}
            width={1080}
            height={1080}
            loading="lazy"
            decoding="async"
          />
        ))}
      </div>
      <div className="kit-body">
        <div className="kit-head">
          <span className="kit-no">{post.label}</span>
          <h3>{post.title}</h3>
          <span className="kit-day">
            Day {post.day}
            {many ? `, ${post.files.length} pictures` : ""}
          </span>
        </div>
        <p className="kit-caption">{post.caption}</p>
        <div className="kit-acts">
          <CopyText text={post.caption} label="Copy caption" />
          {post.files.map((f, i) => (
            <a key={f} className="btn ghost small" href={kitFileHref(f, true)} download={f.split("/").pop()}>
              {many ? `Picture ${i + 1}` : "Download picture"}
            </a>
          ))}
        </div>
        <div className="kit-posted">
          {CHANNELS.map((c) => {
            const mark = marks?.[c];
            return (
              <label className="check-row" key={c}>
                <input
                  className="check-24"
                  type="checkbox"
                  checked={Boolean(mark)}
                  disabled={busy}
                  onChange={(e) => toggle(post.id, c, e.target.checked)}
                />
                <span>
                  On {CHANNEL_LABEL[c]}
                  {mark && (
                    <small>
                      {" "}
                      · {displayName(mark.by)}, <RelativeTime at={mark.at} />
                    </small>
                  )}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One post as a compact row: picture, number, title, day and its ticks. Opens into the full card. */
function PostRow({ open, onOpen, ...card }: CardProps & { open: boolean; onOpen: () => void }) {
  const { post, marks } = card;
  return (
    <li className={`kit-row${open ? " is-open" : ""}`} id={`row-${post.id}`}>
      <button type="button" className="kit-row-head" aria-expanded={open} onClick={onOpen}>
        <img src={kitFileHref(post.files[0] ?? "")} alt="" width={48} height={48} loading="lazy" decoding="async" />
        <span className="kit-no">{post.label}</span>
        <span className="kit-row-title">{post.title}</span>
        <span className="kit-day">Day {post.day}</span>
        <span className="kit-row-marks">
          {CHANNELS.map((c) => (
            <span key={c} className={`kit-mark${marks?.[c] ? " is-on" : ""}`}>
              {marks?.[c] && <CheckIcon size={12} />}
              {CHANNEL_LABEL[c]}
            </span>
          ))}
        </span>
      </button>
      {open && <PostCard {...card} />}
    </li>
  );
}

export default function KitBoard({
  kit,
  initialPosted,
  kitUrl,
}: {
  kit: Kit;
  initialPosted: PostedMap;
  /** The kit site, for the full page with stories and highlight covers. */
  kitUrl: string;
}) {
  const [posted, setPosted] = useState<PostedMap>(initialPosted);
  const [show, setShow] = useState<Show>("todo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c: Record<KitChannel, number> = { instagram: 0, facebook: 0 };
    for (const p of kit.posts) for (const ch of CHANNELS) if (posted[p.id]?.[ch]) c[ch]++;
    return c;
  }, [kit.posts, posted]);

  const toggle = async (id: string, channel: KitChannel, value: boolean) => {
    const before = posted;
    // Optimistic: the tick moves at once and is corrected by the answer.
    setPosted((current) => {
      const { [channel]: _removed, ...others } = current[id] ?? {};
      return { ...current, [id]: value ? { ...others, [channel]: { at: new Date().toISOString(), by: "you" } } : others };
    });
    setBusy(true);
    setError(null);
    const res = await fetch("/api/sales/kit/posted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, channel, posted: value }),
    }).catch(() => null);
    const data = res ? ((await res.json().catch(() => null)) as { marks?: PostedMap[string]; error?: string } | null) : null;
    setBusy(false);
    if (!res?.ok || !data?.marks) {
      setPosted(before);
      setError(data?.error || "That tick did not save. Please try again.");
      return;
    }
    const marks = data.marks;
    setPosted((current) => ({ ...current, [id]: marks }));
  };

  const todo = kit.posts.filter((p) => !isDone(posted, p.id));
  const next = todo[0];
  // Next up: every post of the next posting day (usually the drawing and the words post).
  const nextDay = next ? kit.posts.filter((p) => p.day === next.day) : [];
  const shown = show === "all" ? kit.posts : show === "done" ? kit.posts.filter((p) => isDone(posted, p.id)) : todo;
  const weeks = useMemo(() => {
    const map = new Map<number, KitPost[]>();
    for (const p of shown) map.set(weekOf(p.day), [...(map.get(weekOf(p.day)) ?? []), p]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [shown]);
  const nextWeek = next ? weekOf(next.day) : 0;
  const [opened, setOpened] = useState<string | null>(null);
  const card = (p: KitPost) => ({ post: p, marks: posted[p.id], busy, toggle: (id: string, c: KitChannel, v: boolean) => void toggle(id, c, v) });

  return (
    <>
      <section className="card" aria-labelledby="kit-title">
        <div className="card-head">
          <h3 id="kit-title">Posts</h3>
          <span className="save-state">
            {counts.instagram} of {kit.posts.length} on Instagram · {counts.facebook} on Facebook
          </span>
        </div>
        <p className="empty-note">
          Two a day, in order: the drawing first, then the words post. Tick a post when it is up, so nobody posts it
          twice.{" "}
          {next ? (
            <>
              Next up is{" "}
              <a className="sales-link" href={`#post-${next.id}`}>
                {next.label}, {next.title}
              </a>
              .
            </>
          ) : (
            "Everything in the kit is posted."
          )}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {next && (
          <>
            <h4 className="kit-sub">Next up, day {next.day}</h4>
            <ul className="kit-posts">
              {nextDay.map((p) => (
                <li key={p.id}>
                  <PostCard {...card(p)} anchor />
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="kit-all">
        <div className="card-head">
          <h3 id="kit-all">All posts, by week</h3>
        </div>
        <div className="sales-filters" role="group" aria-label="Show">
          <button type="button" className="btn ghost small" aria-pressed={show === "todo"} onClick={() => setShow("todo")}>
            To post {todo.length}
          </button>
          <button type="button" className="btn ghost small" aria-pressed={show === "done"} onClick={() => setShow("done")}>
            Posted {kit.posts.length - todo.length}
          </button>
          <button type="button" className="btn ghost small" aria-pressed={show === "all"} onClick={() => setShow("all")}>
            All {kit.posts.length}
          </button>
        </div>
        {weeks.length === 0 ? (
          <p className="empty-note">
            {show === "done" ? "Nothing is ticked as posted yet." : "Nothing left to post. Ask for more posts when the list runs out."}
          </p>
        ) : (
          <div className="kit-weeks">
            {weeks.map(([week, posts]) => {
              const days = posts.map((p) => p.day);
              const up = posts.filter((p) => isDone(posted, p.id)).length;
              return (
                <details key={`${show}-${week}`} className="kit-week" open={week === nextWeek || weeks.length === 1}>
                  <summary>
                    <span className="kit-week-name">Week {week}</span>
                    <span className="kit-day">
                      Days {Math.min(...days)} to {Math.max(...days)} · {posts.length} {posts.length === 1 ? "post" : "posts"}
                      {show !== "todo" ? `, ${up} posted` : ""}
                    </span>
                  </summary>
                  <ul className="kit-rows">
                    {posts.map((p) => (
                      <PostRow
                        key={p.id}
                        {...card(p)}
                        open={opened === p.id}
                        onOpen={() => setOpened((o) => (o === p.id ? null : p.id))}
                      />
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="kit-profile">
        <h3 id="kit-profile">Profile and covers</h3>
        <dl className="sales-facts" style={{ marginTop: 12 }}>
          <div>
            <dt>Instagram</dt>
            <dd>
              @{kit.profile.handle} · {kit.profile.name}
            </dd>
          </div>
          <div>
            <dt>Bio</dt>
            <dd style={{ whiteSpace: "pre-line" }}>{kit.profile.bio}</dd>
          </div>
        </dl>
        <div className="kit-acts" style={{ marginTop: 12 }}>
          <CopyText text={kit.profile.bio} label="Copy Instagram bio" />
          <CopyText text={kit.facebook.bio} label="Copy Facebook bio" />
          {kit.extras.map((x) => (
            <a key={x.file} className="btn ghost small" href={kitFileHref(x.file, true)} download={x.file.split("/").pop()}>
              {x.label}
            </a>
          ))}
        </div>
        <p className="empty-note">
          Stories and highlight covers are on{" "}
          <a className="sales-link" href={kitUrl} target="_blank" rel="noopener noreferrer">
            the full kit page
          </a>
          .
        </p>
      </section>
    </>
  );
}
