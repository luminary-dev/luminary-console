// The social kit as the console reads it (lib/kit.ts) and the two routes
// around it: the picture hand-through, which must not become an open proxy,
// and the shared "this post is up" ticks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PostedMap } from "@/lib/kit";

const ME = "dhanikaanupama2000@gmail.com";
const mem = vi.hoisted(() => ({ state: new Map<string, unknown>(), operator: "" }));

vi.mock("@/lib/store", () => {
  class StoreConflictError extends Error {}
  const get = (path: string) => (mem.state.has(path) ? structuredClone(mem.state.get(path)) : null);
  return {
    StoreConflictError,
    readState: async (path: string) => get(path),
    updateState: async (path: string, mutate: (current: unknown) => unknown) => {
      const next = mutate(get(path));
      mem.state.set(path, structuredClone(next));
      return next;
    },
  };
});
vi.mock("@/lib/operator", () => ({ currentOperator: async () => mem.operator }));

import { GET as file } from "@/app/api/sales/kit/file/route";
import { POST as tick } from "@/app/api/sales/kit/posted/route";
import { fetchKit, getPosted, isKitFile, kitFileHref, kitOrigin } from "@/lib/kit";

const KIT = {
  generatedAt: "2026-11-24T00:00:00.000Z",
  profile: { name: "Luminary", handle: "luminary.xyz", url: "https://www.instagram.com/luminary.xyz/", category: "Web Designer", bio: "Websites" },
  facebook: { name: "Luminary", category: "Web Designer", bio: "Websites", about: "About" },
  posts: [
    { id: "b1", label: "B1", title: "Hello", day: 1, files: ["buildup/b1-hello.jpg"], caption: "Hello", alt: "Two designers" },
    { id: "4", label: "04", title: "How it works", day: 5, files: ["posts/04-how-it-works-1.jpg", "posts/04-how-it-works-2.jpg"], caption: "Steps", alt: "Steps" },
  ],
  highlights: [{ key: "work", name: "Work", cover: "highlights/cover-work.jpg", stories: ["stories/work-01.jpg"] }],
  extras: [{ label: "Profile picture", file: "profile-picture.jpg" }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const image = () => new Response(new Uint8Array([255, 216, 255]), { status: 200, headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } });
const fileReq = (query: string) => new Request(`https://console.example.test/api/sales/kit/file?${query}`);
const tickReq = (body: unknown) =>
  new Request("https://console.example.test/api/sales/kit/posted", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  mem.state.clear();
  mem.operator = ME;
  delete process.env.KIT_ORIGIN;
  delete process.env.KIT_BYPASS_SECRET;
});
afterEach(() => vi.unstubAllGlobals());

describe("isKitFile", () => {
  it("accepts a picture inside the kit's out folder", () => {
    for (const p of ["posts/01-luvana.jpg", "buildup/b1-hello.jpg", "profile-picture.jpg", "stories/how-04-1.jpg", "x/y.webp"]) {
      expect(isKitFile(p), p).toBe(true);
    }
  });

  it("refuses anything that could reach another file or another host", () => {
    for (const p of ["", "../kit.json", "posts/../../secret.jpg", "/etc/passwd", "posts//a.jpg", "kit.json", "posts/a.JPG", "https://evil.test/a.jpg", "posts/a.jpg?x=1", "posts/a b.jpg", ".env.jpg"]) {
      expect(isKitFile(p), p).toBe(false);
    }
  });
});

describe("fetchKit", () => {
  it("reads and validates the manifest from the configured origin", async () => {
    process.env.KIT_ORIGIN = "https://kit.example.test/";
    const fetchMock = vi.fn(async (_url: string) => json(KIT));
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchKit();
    expect(out.ok && out.kit.posts).toHaveLength(2);
    expect(kitOrigin()).toBe("https://kit.example.test");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://kit.example.test/kit.json");
  });

  it("sends the bypass secret only when one is configured", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => json(KIT));
    vi.stubGlobal("fetch", fetchMock);
    await fetchKit();
    expect((fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>)["x-vercel-protection-bypass"]).toBeUndefined();
    process.env.KIT_BYPASS_SECRET = "s3";
    await fetchKit();
    expect((fetchMock.mock.calls[1]?.[1]?.headers as Record<string, string>)["x-vercel-protection-bypass"]).toBe("s3");
  });

  it("explains a private kit site, an error, a bad manifest and an unreachable host, without throwing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { Location: "https://vercel.com/sso-api" } })));
    expect(await fetchKit()).toMatchObject({ ok: false, reason: expect.stringContaining("KIT_BYPASS_SECRET") });
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 500)));
    expect(await fetchKit()).toMatchObject({ ok: false, reason: expect.stringContaining("500") });
    vi.stubGlobal("fetch", vi.fn(async () => json({ ...KIT, posts: [{ ...KIT.posts[0], files: ["../kit.json"] }] })));
    expect(await fetchKit()).toMatchObject({ ok: false, reason: expect.stringContaining("Rebuild the kit") });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchKit()).toMatchObject({ ok: false, reason: "The kit site could not be reached." });
  });
});

describe("GET /api/sales/kit/file", () => {
  it("hands a picture through from the kit site, and as a download when asked", async () => {
    const fetchMock = vi.fn(async (_url: string) => image());
    vi.stubGlobal("fetch", fetchMock);
    const shown = await file(fileReq("path=posts%2F01-luvana.jpg"));
    expect(shown.status).toBe(200);
    expect(shown.headers.get("Content-Type")).toBe("image/jpeg");
    expect(shown.headers.get("Content-Disposition")).toBeNull();
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://kit.shopfront.luminary-dev.xyz/out/posts/01-luvana.jpg");

    const saved = await file(fileReq("path=posts%2F01-luvana.jpg&dl=1"));
    expect(saved.headers.get("Content-Disposition")).toBe('attachment; filename="01-luvana.jpg"');
    expect(kitFileHref("posts/01-luvana.jpg", true)).toBe("/api/sales/kit/file?path=posts%2F01-luvana.jpg&dl=1");
  });

  it("refuses a path outside the kit before any request is made", async () => {
    const fetchMock = vi.fn(async () => image());
    vi.stubGlobal("fetch", fetchMock);
    for (const q of ["path=..%2Fkit.json", "path=https%3A%2F%2Fevil.test%2Fa.jpg", "path=", "nothing=1"]) {
      expect((await file(fileReq(q))).status, q).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not pass on a login page, an error or anything that is not an image", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } })));
    expect((await file(fileReq("path=posts%2Fa.jpg"))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302 })));
    expect((await file(fileReq("path=posts%2Fa.jpg"))).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("gone", { status: 404 })));
    expect((await file(fileReq("path=posts%2Fa.jpg"))).status).toBe(404);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect((await file(fileReq("path=posts%2Fa.jpg"))).status).toBe(502);
  });
});

describe("POST /api/sales/kit/posted", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => json(KIT))));

  it("ticks a post for one platform against the operator, and unticks it", async () => {
    const res = await tick(tickReq({ id: "b1", channel: "instagram", posted: true }));
    expect(res.status).toBe(200);
    expect((await res.json()).marks.instagram.by).toBe(ME);
    await tick(tickReq({ id: "b1", channel: "facebook", posted: true }));
    expect(Object.keys((await getPosted()).b1 ?? {}).sort()).toEqual(["facebook", "instagram"]);

    const off = await tick(tickReq({ id: "b1", channel: "instagram", posted: false }));
    expect((await off.json()).marks).not.toHaveProperty("instagram");
    expect(((mem.state.get("sales/posted.json") as PostedMap).b1 ?? {}).facebook?.by).toBe(ME);
  });

  it("refuses a post that is not in the kit, an unknown platform and a malformed body", async () => {
    expect((await tick(tickReq({ id: "999", channel: "instagram", posted: true }))).status).toBe(404);
    expect((await tick(tickReq({ id: "b1", channel: "tiktok", posted: true }))).status).toBe(400);
    expect((await tick(tickReq({ id: "b1", channel: "instagram", posted: "yes" }))).status).toBe(400);
    expect(mem.state.has("sales/posted.json")).toBe(false);
  });

  it("answers 502 with the reason when the kit cannot be read", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    const res = await tick(tickReq({ id: "b1", channel: "instagram", posted: true }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("503");
  });
});
