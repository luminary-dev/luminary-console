import SessionGuard from "@/components/SessionGuard";
import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Outfit, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Luminary Console", template: "%s — Luminary" },
  description: "Luminary Studio client console.",
  robots: { index: false, follow: false },
  manifest: "/manifest.webmanifest",
  // apple must be a PNG — iOS ignores SVG touch icons and falls back to a
  // blank page-snapshot tile on the home screen.
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Luminary", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f0f0ee" },
    { media: "(prefers-color-scheme: dark)", color: "#050506" },
  ],
};

const themeInitScript = `(function(){var d=document.documentElement;if(d.dataset.theme)return;var t=null;try{t=localStorage.getItem('luminary-theme');}catch(e){}if(t!=='light'&&t!=='dark'){try{t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';}catch(e){t='light';}}d.dataset.theme=t;try{document.cookie='luminary-theme='+t+';path=/;max-age=31536000;samesite=lax';}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const saved = (await cookies()).get("luminary-theme")?.value;
  const theme = saved === "dark" || saved === "light" ? saved : undefined;
  return (
    <html lang="en" suppressHydrationWarning data-theme={theme} className={`${outfit.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <style>{`html{background:#f0f0ee;color-scheme:light}html[data-theme="dark"]{background:#050506;color-scheme:dark}`}</style>
      </head>
      <body>{children}<SessionGuard /></body>
    </html>
  );
}
