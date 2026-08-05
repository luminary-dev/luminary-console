"use client";

import { useState } from "react";

export default function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
      <a href={url} target="_blank" rel="noopener noreferrer" className="mono" style={{ fontSize: 12.5 }}>
        {url.replace("https://", "")}
      </a>
      <button
        className="btn ghost small"
        style={{ padding: "2px 10px", fontSize: 11 }}
        onClick={async () => {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </span>
  );
}
