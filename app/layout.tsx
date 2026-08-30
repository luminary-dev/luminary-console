import SessionGuard from "@/components/SessionGuard";
import SkipLink from "@/components/SkipLink";
import type { Metadata, Viewport } from "next";
import { cookies, headers } from "next/headers";
import { Outfit, JetBrains_Mono, Unkempt } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });
// Comic lettering, for the hub comic's speech balloons and nothing else.
// Loaded through next/font like the other two, which downloads the file at
// build time and serves it from our own origin: the CSP is `font-src 'self'
// data:` and a Google Fonts URL would simply be blocked.
// 700 only. The balloons are the sole user and they are always bold, so
// shipping the other weights would be bytes nobody downloads a glyph from.
const comic = Unkempt({ subsets: ["latin"], weight: ["700"], variable: "--font-comic", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Luminary Console", template: "%s · Luminary" },
  description: "Luminary Studio client console.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  // apple must be a PNG — iOS ignores SVG touch icons and falls back to a
  // blank page-snapshot tile on the home screen.
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Luminary", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  // cover exposes env(safe-area-inset-*) so the installed app can clear the
  // Dynamic Island / home indicator; body picks up the left/right insets in
  // globals.css, which are 0 in browser portrait — web view unchanged.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f0ee" },
    { media: "(prefers-color-scheme: dark)", color: "#050506" },
  ],
};

const themeInitScript = `(function(){var d=document.documentElement;if(d.dataset.theme)return;var t=null;try{t=localStorage.getItem('luminary-theme');}catch(e){}if(t!=='light'&&t!=='dark'){try{t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}catch(e){t='light';}}d.dataset.theme=t;try{document.cookie='luminary-theme='+t+';path=/;max-age=31536000;samesite=lax';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const saved = (await cookies()).get("luminary-theme")?.value;
  const theme = saved === "dark" || saved === "light" ? saved : undefined;
  // Per-request nonce from proxy.ts (LC-012). It is absent on the client
  // subdomains, which run the relaxed document policy instead: see lib/csp.ts.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning data-theme={theme} className={`${outfit.variable} ${mono.variable} ${comic.variable}`}>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{`html{background:#f0f0ee;color-scheme:light}html[data-theme="dark"]{background:#050506;color-scheme:dark}`}</style>
      </head>
      <body>
        {/* First tab stop on every page, so a keyboard user is not walked
            through the topbar on every navigation. */}
        <SkipLink />
        {children}
        <SessionGuard />
      </body>
    </html>
  );
}
