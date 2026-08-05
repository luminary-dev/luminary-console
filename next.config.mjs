/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["@sparticuz/chromium", "puppeteer-core"],
  // Chromium's brotli-packed binaries load dynamically at runtime — the file
  // tracer can't see them, so include them in every function that might
  // render a PDF (client create, doc regenerate, questionnaire submit).
  outputFileTracingIncludes: {
    "/**": ["./node_modules/@sparticuz/chromium/bin/**/*"],
  },
};

export default nextConfig;
