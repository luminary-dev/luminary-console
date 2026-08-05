// Shared document shell — the Luminary business-doc design system (tokens,
// header, client/meta grid, footer, print rules) that every generated doc
// renders through. "web" mode adds a floating PRINT/PDF toolbar; "pdf" mode
// is what Chromium prints.
import type { ClientRecord } from "../types";

export const esc = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** Multi-line plain text → <p> paragraphs. */
export const paras = (s: string) =>
  s
    .split(/\n+/)
    .map((l) => `<p>${esc(l)}</p>`)
    .join("");

export type Mode = "web" | "pdf";

const CSS = `
:root{--bg:#ffffff;--off:#f7f7f5;--text:#0d0d0f;--muted:#6b7280;--subtle:#c4c4c8;--border:rgba(0,0,0,.09);--border-hi:rgba(0,0,0,.14);--accent:#84cc16;--a-text:#5a9e08;--a-dim:rgba(132,204,22,.09);--a-border:rgba(132,204,22,.28);--desk:#f0f0ee;--mono:'JetBrains Mono',ui-monospace,monospace;--sans:'Outfit',system-ui,sans-serif;}
html[data-theme="dark"]{--bg:#0b0b0d;--off:#141416;--text:#f4f4f5;--muted:#8a8a92;--subtle:#3f3f46;--border:rgba(255,255,255,.09);--border-hi:rgba(255,255,255,.16);--accent:#a3e635;--a-text:#a3e635;--a-dim:rgba(163,230,53,.09);--a-border:rgba(163,230,53,.22);--desk:#050506;}
html{color-scheme:light;}
html[data-theme="dark"]{color-scheme:dark;}
*{box-sizing:border-box;margin:0;padding:0;}
body{background:var(--desk);font-family:var(--sans);color:var(--text);font-size:13.5px;line-height:1.6;}
a{color:var(--a-text);text-decoration:none;}
.sheet{width:820px;max-width:100%;margin:0 auto;background:var(--bg);padding:44px 52px 34px;min-height:100vh;}
.web .sheet{margin:32px auto 60px;border:1px solid var(--border);border-radius:18px;min-height:auto;}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;padding-bottom:20px;border-bottom:1px solid var(--border);}
.brand{font-size:25px;font-weight:800;letter-spacing:-.04em;line-height:1;}
.brand span{color:var(--accent);}
.brand-sub{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-top:7px;}
.doc-title{font-size:27px;font-weight:800;letter-spacing:-.03em;line-height:.9;text-align:right;}
.pill{display:inline-flex;align-items:center;gap:6px;margin-top:11px;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--a-text);background:var(--a-dim);border:1px solid var(--a-border);border-radius:100px;padding:4px 12px;}
.pill i{width:5px;height:5px;border-radius:50%;background:var(--accent);display:inline-block;}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:28px;padding:18px 0;border-bottom:1px solid var(--border);}
.meta-k{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--subtle);margin-bottom:9px;}
.meta-name{font-size:15px;font-weight:700;}
.meta-detail{font-size:12.5px;color:var(--muted);line-height:1.65;margin-top:5px;}
.meta-rows{display:flex;flex-direction:column;gap:9px;}
.meta-row{display:flex;justify-content:space-between;gap:12px;font-size:12.5px;}
.meta-row span:first-child{color:var(--muted);}
.meta-row span:last-child{font-weight:600;text-align:right;}
.mono{font-family:var(--mono);}
.section{margin-top:20px;}
.sec-k{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--subtle);margin-bottom:8px;break-after:avoid;}
.sec-h{font-size:15.5px;font-weight:700;letter-spacing:-.02em;margin-bottom:6px;break-after:avoid;}
.lead{font-size:13.5px;line-height:1.65;}
.lead p+p{margin-top:7px;}
.tbl-head{display:grid;gap:12px;padding:0 4px 9px;border-bottom:1.5px solid var(--border-hi);font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);}
.tbl-row{display:grid;gap:12px;padding:12px 4px;border-bottom:1px solid var(--border);align-items:baseline;break-inside:avoid;}
.item-t{font-size:13.5px;font-weight:600;}
.item-d{font-size:12px;color:var(--muted);margin-top:2px;}
.amt{text-align:right;font-family:var(--mono);font-size:12.5px;font-weight:600;white-space:nowrap;}
.totals{display:flex;justify-content:flex-end;padding-top:16px;break-inside:avoid;}
.totals-box{width:330px;display:flex;flex-direction:column;gap:9px;}
.t-row{display:flex;justify-content:space-between;font-size:12.5px;}
.t-row span:first-child{color:var(--muted);}
.t-row span:last-child{font-family:var(--mono);font-weight:600;}
.t-main{display:flex;justify-content:space-between;align-items:center;margin-top:5px;padding:13px 16px;background:var(--a-dim);border:1px solid var(--a-border);border-radius:12px;}
.t-main b{font-size:13.5px;font-weight:700;}
.t-main .val{font-family:var(--mono);font-size:19px;font-weight:700;letter-spacing:-.02em;}
.t-note{text-align:right;font-size:10.5px;color:var(--muted);font-family:var(--mono);}
.box{margin-top:18px;padding:16px 20px;background:var(--off);border:1px solid var(--border);border-radius:14px;break-inside:avoid;}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:22px;}
.small{font-size:12px;color:var(--muted);line-height:1.75;}
.clause{margin-top:14px;break-inside:avoid;}
.clause-t{font-size:13px;font-weight:700;margin-bottom:4px;}
.clause p{font-size:12.5px;color:var(--text);line-height:1.65;}
.clause p+p{margin-top:5px;}
.sig{display:grid;grid-template-columns:1fr 1fr;gap:36px;margin-top:34px;break-inside:avoid;}
.sig-block{border-top:1.5px solid var(--border-hi);padding-top:10px;}
.sig-k{font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--subtle);}
.sig-line{margin-top:34px;border-bottom:1px solid var(--border-hi);}
.sig-lab{font-size:11px;color:var(--muted);margin-top:5px;}
.ticks{list-style:none;}
.ticks li{padding-left:18px;position:relative;font-size:12.5px;margin-top:3px;}
.ticks li:before{content:"\\2713";position:absolute;left:0;color:var(--a-text);font-weight:700;}
.foot{margin-top:26px;padding-top:12px;border-top:1px solid var(--border);text-align:center;font-family:var(--mono);font-size:10.5px;color:var(--muted);}
.toolbar{position:fixed;top:16px;right:16px;display:flex;gap:8px;z-index:10;}
.toolbar a,.toolbar button{border:none;cursor:pointer;background:var(--text);color:var(--bg);border-radius:100px;padding:8px 18px;font-family:var(--mono);font-size:11px;font-weight:600;letter-spacing:.04em;}
.theme-toggle{position:relative;width:52px;height:28px;flex-shrink:0;border:1px solid var(--border)!important;border-radius:100px;background:var(--off)!important;cursor:pointer;padding:0!important;box-shadow:inset 2px 2px 5px rgba(0,0,0,.12),inset -2px -2px 5px rgba(255,255,255,.6);align-self:center;}
html[data-theme="dark"] .theme-toggle{box-shadow:inset 2px 2px 6px rgba(0,0,0,.55),inset -2px -2px 6px rgba(255,255,255,.04);}
.theme-toggle:active{transform:scale(.96);}
.theme-toggle__knob{position:absolute;top:50%;left:3px;transform:translateY(-50%);width:22px;height:22px;border-radius:50%;background:var(--accent);color:#0d0d0f;display:flex;align-items:center;justify-content:center;transition:transform .3s cubic-bezier(.5,1.4,.6,1);}
html[data-theme="dark"] .theme-toggle__knob{transform:translate(22px,-50%);}
.theme-toggle__ico{position:absolute;display:flex;align-items:center;justify-content:center;}
.theme-toggle__ico svg{width:12px;height:12px;}
.theme-toggle__moon{display:none;}
html[data-theme="dark"] .theme-toggle__sun{display:none;}
html[data-theme="dark"] .theme-toggle__moon{display:flex;}
html[data-reveal] *{transition:none!important;}
.sow{width:100%;border-collapse:collapse;margin-top:6px;break-inside:avoid;}
.sow th{text-align:left;vertical-align:top;width:132px;font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);padding:9px 12px;border:1px solid var(--border-hi);background:var(--off);}
.sow td{padding:9px 12px;font-size:12.5px;border:1px solid var(--border-hi);line-height:1.6;}
.qa{margin-top:13px;break-inside:avoid;}
.q{font-size:12.5px;font-weight:600;}
.a{margin-top:5px;padding:9px 12px;background:var(--off);border:1px solid var(--border);border-radius:9px;font-size:12.5px;}
.a p+p{margin-top:5px;}
.a .empty{color:var(--subtle);}
@page{size:A4;margin:14mm 0 16mm;}
@media print{
 /* Documents always print light, whatever the on-screen theme. */
 :root,html[data-theme="dark"]{--bg:#ffffff;--off:#f7f7f5;--text:#0d0d0f;--muted:#6b7280;--subtle:#c4c4c8;--border:rgba(0,0,0,.09);--border-hi:rgba(0,0,0,.14);--accent:#84cc16;--a-text:#5a9e08;--a-dim:rgba(132,204,22,.09);--a-border:rgba(132,204,22,.28);--desk:#ffffff;}
 .toolbar{display:none!important;}body{background:#fff;}.sheet{border:none;border-radius:0;margin:0;width:100%;}
}
@media (max-width:640px){
 .sheet{padding:28px 18px;}
 .meta,.cols2,.sig{grid-template-columns:1fr;gap:18px;}
 .doc-title,.head>div:last-child{text-align:left;}
 .tbl-head{display:none;}
 .tbl-row{display:flex!important;flex-wrap:wrap;gap:4px 12px;align-items:baseline;border-top:1px solid var(--border);border-bottom:none;padding:12px 0;}
 .tbl-row>div{min-width:0;}
 .tbl-row>.mono:first-child{display:none;}
 .tbl-row .amt{margin-left:auto;}
 .totals-box{width:100%;}
 .toolbar{top:auto;bottom:14px;right:14px;}
}
`;

export function metaRow(k: string, v: string, mono = false): string {
  return `<div class="meta-row"><span>${esc(k)}</span><span${mono ? ' class="mono"' : ""}>${esc(v)}</span></div>`;
}

export function clientBlock(client: ClientRecord, heading = "Prepared for"): string {
  const lines = [
    client.reg ? `Reg. No: ${client.reg}` : null,
    client.address || null,
    client.email || null,
    client.phone || null,
  ]
    .filter(Boolean)
    .map((l) => esc(l as string))
    .join("<br>");
  return `<div>
    <div class="meta-k">${esc(heading)}</div>
    <div class="meta-name">${esc(client.company)}</div>
    <div class="meta-detail">${lines}</div>
  </div>`;
}

export function shell(opts: {
  mode: Mode;
  title: string;
  docTitle: string;
  pill: string;
  metaLeft: string;
  metaRightRows: string[];
  body: string;
  pdfHref?: string;
}): string {
  const toolbar =
    opts.mode === "web"
      ? `<div class="toolbar"><button class="theme-toggle" aria-label="Toggle light and dark theme" onclick="__flipTheme(this)"><span class="theme-toggle__knob"><span class="theme-toggle__ico theme-toggle__sun"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></span><span class="theme-toggle__ico theme-toggle__moon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg></span></span></button>${opts.pdfHref ? `<a href="${opts.pdfHref}">PDF</a>` : ""}<button onclick="window.print()">PRINT</button></div>`
      : "";
  // Pre-paint theme pick (web only): saved choice, else system preference.
  const themeScript =
    opts.mode === "web"
      ? `<script>(function(){var d=document.documentElement;var t=null;try{t=localStorage.getItem('luminary-theme')}catch(e){}if(t!=='light'&&t!=='dark'){try{t=window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light'}catch(e){t='light'}}d.dataset.theme=t;})();
function __flipTheme(btn){var d=document.documentElement;var next=d.dataset.theme==='dark'?'light':'dark';var apply=function(){d.dataset.theme=next;try{localStorage.setItem('luminary-theme',next);document.cookie='luminary-theme='+next+';path=/;max-age=31536000;samesite=lax'}catch(e){}};var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;if(!document.startViewTransition||reduce){apply();return}var r=btn.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;var rad=Math.hypot(Math.max(x,window.innerWidth-x),Math.max(y,window.innerHeight-y));var t=document.startViewTransition(function(){d.setAttribute('data-reveal','');apply()});t.ready.then(function(){d.animate({clipPath:['circle(0px at '+x+'px '+y+'px)','circle('+rad.toFixed(1)+'px at '+x+'px '+y+'px)']},{duration:600,easing:'linear',pseudoElement:'::view-transition-new(root)'})}).catch(function(){});t.finished.finally(function(){d.removeAttribute('data-reveal')})}</script>`
      : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(opts.title)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%230d0d0f'/%3E%3Ctext x='16' y='23' text-anchor='middle' font-size='20' font-weight='900' font-family='system-ui' fill='%2384cc16'%3EL%3C/text%3E%3C/svg%3E">
${themeScript}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style>
</head>
<body class="${opts.mode}">
${toolbar}
<div class="sheet">
  <div class="head">
    <div>
      <div class="brand">Luminary<span>.</span></div>
      <div class="brand-sub">Full-Service Digital Studio</div>
    </div>
    <div>
      <div class="doc-title">${esc(opts.docTitle)}</div>
      <div style="text-align:right;"><span class="pill"><i></i>${esc(opts.pill)}</span></div>
    </div>
  </div>
  <div class="meta">
    ${opts.metaLeft}
    <div class="meta-rows">${opts.metaRightRows.join("")}</div>
  </div>
  ${opts.body}
  <div class="foot">support@luminary-dev.xyz · +94 77 16 18 093 · luminary-dev.xyz</div>
</div>
</body>
</html>`;
}
