"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import SignOut from "@/components/SignOut";
import ThemeToggle from "@/components/ThemeToggle";
import AppTabBar from "@/components/AppTabBar";
import { opsFetch } from "@/lib/ops-fetch";

export default function NewClientPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [f, setF] = useState({
    company: "",
    slug: "",
    address: "",
    email: "",
    phone: "",
    contactName: "",
    brief: "",
  });

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await opsFetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(f),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.slug) {
      router.push(`/clients/${data.slug}`);
    } else {
      setError(data?.error || `Failed (${res.status}).`);
      setBusy(false);
    }
  };

  return (
    <main className="wrap wrap--narrow" style={{ paddingBottom: 80 }}>
      <div className="topbar">
        <div className="brand">
          Luminary<span>.</span>
          <small>New client</small>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <ThemeToggle />
          <SignOut />
          <Link className="btn ghost small app-hide" href="/">
            ← Dashboard
          </Link>
        </div>
      </div>
      {/* Skip-link target. The topbar lives inside <main> on every console
          page, so the jump lands here, after the nav, and the next Tab
          continues into the content. tabIndex makes it focusable, which is
          what moves focus rather than only the scroll position. */}
      <div id="main-content" tabIndex={-1} />


      <form className="card" onSubmit={submit}>
        <h3>Client details</h3>
        <div className="q-fields">
          <div className="q-field half">
            <span className="q-label">Company name <span className="req">*</span></span>
            <input className="q-line" value={f.company} onChange={set("company")} required placeholder="Ecomech Engineering Lanka (Pvt) Ltd." />
          </div>
          <div className="q-field half">
            <span className="q-label">Subdomain slug</span>
            <input className="q-line" value={f.slug} onChange={set("slug")} placeholder="auto from name, e.g. eco-mech" />
          </div>
          <div className="q-field half">
            <span className="q-label">Contact person</span>
            <input className="q-line" value={f.contactName} onChange={set("contactName")} />
          </div>
          <div className="q-field">
            <span className="q-label">Address</span>
            <input className="q-line" value={f.address} onChange={set("address")} />
          </div>
          <div className="q-field half">
            <span className="q-label">Email</span>
            <input className="q-line" value={f.email} onChange={set("email")} />
          </div>
          <div className="q-field half">
            <span className="q-label">Phone</span>
            <input className="q-line" value={f.phone} onChange={set("phone")} />
          </div>
          <div className="q-field">
            <div>
              <span className="q-label">Project brief <span className="req">*</span></span>
              <div className="q-hint">
                What are we building and for how much? Figures you give are treated as authoritative.
                Mention the reg. no here if you have it. It&apos;s picked up automatically. e.g.
                &quot;Landing page. UX 5–10k, development 30–40k LKR. Reg no PV110496. Client is an MEP
                engineering firm bidding for hotel tenders in October.&quot;
              </div>
            </div>
            <textarea className="q-box" rows={5} value={f.brief} onChange={set("brief")} required />
          </div>
        </div>

        {error && <div className="form-error">{error}</div>}
        {busy && (
          <div className="notice">
            Working: the estimate is being drafted, the questionnaire tailored, the documents
            rendered to PDF, and the subdomain provisioned. This takes about a minute; don&apos;t
            close the tab.
          </div>
        )}
        <button className="btn" style={{ marginTop: 22 }} disabled={busy}>
          {busy ? "Generating…" : "Create client & generate documents"}
        </button>
      </form>
      <AppTabBar />
    </main>
  );
}
