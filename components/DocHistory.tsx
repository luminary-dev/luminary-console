// Superseded renders of one document, newest first. A plain <details> so it
// costs no JavaScript and still collapses — the rows below it are already
// dense enough without permanently listing old versions.
//
// The links point straight at the archived blobs: every save writes a fresh
// random-suffixed URL, so an old version stays byte-identical and reachable
// forever, and the /preview route only ever knows about the current one.
import type { DocVersion } from "@/lib/types";
import { whenLabel } from "@/lib/time";

export default function DocHistory({ history }: { history?: DocVersion[] }) {
  if (!history?.length) return null;
  const versions = [...history].reverse();

  return (
    <details className="hist">
      <summary>{`History (${versions.length})`}</summary>
      <div className="hist-list">
        {versions.map((v, i) => (
          <div className="hist-row" key={`${v.at}-${i}`}>
            <span className="mono">v{versions.length - i}</span>
            <span>{whenLabel(v.at)}</span>
            <a href={v.htmlUrl} target="_blank" rel="noopener noreferrer">
              HTML
            </a>
            <a href={v.pdfUrl} target="_blank" rel="noopener noreferrer">
              PDF
            </a>
          </div>
        ))}
      </div>
    </details>
  );
}
