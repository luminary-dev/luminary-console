// A throwaway HTTPS terminator in front of `next start`, for the audit only.
//
// Why this exists, because it is not obvious and the alternative is worse:
//
// The session cookie is `Secure`, correctly and unconditionally. Chromium
// treats http://localhost as a trustworthy origin and sends Secure cookies
// over it anyway; WebKit does not. So an audit run over plain http silently
// redirected every route to /login in the touch project, and reported
// measurements of the sign-in page as though they were measurements of the
// console. The harness was green and the data was worthless.
//
// The options were: weaken `secure: true` behind an env flag, drop WebKit, or
// terminate TLS locally. Weakening a production security control so a test can
// pass is exactly backwards, and dropping WebKit gives up the one browser the
// audit most needs, since Safari is where flex, grid, sticky and scroll
// locking diverge. So: sixty lines of proxy.
//
// The certificate is self-signed and generated on first run into a gitignored
// directory. Playwright trusts it via `ignoreHTTPSErrors`.
import { createServer } from "node:https";
import { request } from "node:http";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";

const UPSTREAM_PORT = Number(process.env.IX_UPSTREAM_PORT || 3199);
const TLS_PORT = Number(process.env.IX_TLS_PORT || 3200);
const DIR = "docs/audit/interaction/.auth";
const KEY = `${DIR}/dev-key.pem`;
const CERT = `${DIR}/dev-cert.pem`;

if (!existsSync(KEY) || !existsSync(CERT)) {
  mkdirSync(DIR, { recursive: true });
  // -nodes so the key is unencrypted: this certificate is for a loopback
  // listener that exists for the length of a test run and is gitignored.
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", KEY, "-out", CERT, "-days", "365",
      "-subj", "/CN=localhost",
      "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore" },
  );
}

const server = createServer(
  { key: readFileSync(KEY), cert: readFileSync(CERT) },
  (req, res) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: UPSTREAM_PORT,
        path: req.url,
        method: req.method,
        headers: {
          ...req.headers,
          host: `localhost:${TLS_PORT}`,
          // Next reads these to build absolute URLs and to decide whether the
          // request arrived over TLS. Without them a redirect would point back
          // at http and the browser would drop the Secure cookie again.
          "x-forwarded-proto": "https",
          "x-forwarded-host": `localhost:${TLS_PORT}`,
        },
      },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream error: ${e.message}`);
    });
    req.pipe(upstream);
  },
);

server.listen(TLS_PORT, () => {
  process.stdout.write(`ix tls proxy: https://localhost:${TLS_PORT} -> http://127.0.0.1:${UPSTREAM_PORT}\n`);
});
