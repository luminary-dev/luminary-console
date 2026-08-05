// Client-site landing: a small branded hub linking whatever is published.
import Link from "next/link";
import { notFound } from "next/navigation";
import { getClient } from "@/lib/store";
import { DOC_LABELS, type DocType } from "@/lib/types";
import ThemeToggle from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const client = await getClient(slug);
  return { title: client ? `Client portal · ${client.company}` : "Client portal" };
}

export default async function ClientHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const client = await getClient(slug);
  if (!client) notFound();

  const published = (Object.keys(client.docs) as DocType[]).filter(
    (t) => client.docs[t]?.status === "published",
  );

  return (
    <main className="sheet" style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <ThemeToggle />
      </div>
      <div className="brand" style={{ fontSize: 26 }}>
        Luminary<span>.</span>
      </div>
      <div className="k" style={{ marginTop: 8, letterSpacing: ".16em" }}>
        Client portal — {client.company}
      </div>
      <div className="card" style={{ marginTop: 24 }}>
        <h3>Your documents</h3>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <Link href="/questionnaire">→ Project questionnaire</Link>
          {published.map((t) => (
            <Link key={t} href={`/${t}`}>
              → {DOC_LABELS[t]} ({client.docs[t]!.no})
            </Link>
          ))}
          {(client.billing ?? [])
            .filter((b) => b.status === "published")
            .map((b) => (
              <Link key={b.slug} href={`/${b.slug}`}>
                → {b.stage === "advance" ? "Advance" : b.stage === "final" ? "Final" : ""} {DOC_LABELS[b.kind]} ({b.no})
              </Link>
            ))}
        </div>
      </div>
      <div className="foot">
        <div className="foot-links">
          <a href="mailto:support@luminary-dev.xyz">support@luminary-dev.xyz</a>
          <i />
          <a href="https://luminary-dev.xyz">luminary-dev.xyz</a>
        </div>
      </div>
    </main>
  );
}
