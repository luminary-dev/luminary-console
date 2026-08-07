// Verify the R2 credentials and print the bucket settings the app needs.
// Writes, reads back and deletes one throwaway probe object — it touches
// nothing else, so it is safe to run against the live bucket.
// Usage: npx tsx scripts/r2-init.ts
import { config } from "dotenv";
config({ path: ".env.local" });

const REQUIRED = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"] as const;

const CORS = [
  {
    AllowedOrigins: [
      `https://${process.env.CONSOLE_HOST || "console.luminary-dev.xyz"}`,
      `https://*.${process.env.ROOT_DOMAIN || "luminary-dev.xyz"}`,
      "http://localhost:3000",
    ],
    AllowedMethods: ["PUT"],
    AllowedHeaders: ["content-type"],
    ExposeHeaders: ["etag"],
    MaxAgeSeconds: 3600,
  },
];

async function main() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`Missing env: ${missing.join(", ")}`);
    console.error("Set them in .env.local (and on Vercel for all three targets), then re-run.");
    process.exit(1);
  }

  const { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } =
    await import("@aws-sdk/client-s3");
  const { r2, bucket } = await import("../lib/r2");
  const client = r2();
  const Bucket = bucket();
  const Key = `console/_probe/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.txt`;
  const payload = `r2-init ${new Date().toISOString()}`;

  console.log(`endpoint  https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  console.log(`bucket    ${Bucket}`);

  await client.send(new PutObjectCommand({ Bucket, Key, Body: payload, ContentType: "text/plain" }));
  console.log(`✓ PUT     ${Key}`);

  const got = await client.send(new GetObjectCommand({ Bucket, Key }));
  const back = await got.Body!.transformToString();
  if (back !== payload) throw new Error(`read-back mismatch: ${JSON.stringify(back)}`);
  console.log("✓ GET     read-after-write consistent");

  const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: "console/", MaxKeys: 5 }));
  console.log(`✓ LIST    ${listed.KeyCount ?? 0} object(s) under console/ (max 5 shown)`);
  for (const o of listed.Contents ?? []) console.log(`          ${o.Key}`);

  await client.send(new DeleteObjectCommand({ Bucket, Key }));
  console.log("✓ DELETE  probe removed");

  console.log(`
Bucket settings to confirm in the Cloudflare dashboard
─────────────────────────────────────────────────────
1. Public access: OFF. Nothing in this bucket may be publicly readable —
   the app serves objects through /api/asset (session-gated) and presigns
   the few links that go into emails. Do NOT connect an r2.dev domain.
2. The API token behind R2_ACCESS_KEY_ID needs "Object Read & Write" on
   this bucket only.
3. CORS — required for browser-direct questionnaire uploads (presigned PUT).
   Paste this into Settings → CORS policy:

${JSON.stringify(CORS, null, 2)}

   The client questionnaire is served from https://<slug>.${process.env.ROOT_DOMAIN || "luminary-dev.xyz"},
   which is why the wildcard origin is there; console previews upload from
   the console host, and localhost covers \`npm run dev\`.
4. Optional: a lifecycle rule deleting "console/_probe/" after 1 day, so a
   killed run of this script can't leave litter behind.
`);
}

main().catch((e) => {
  console.error("\nR2 check FAILED:", e instanceof Error ? e.message : e);
  console.error("\nCommon causes: wrong account id in the endpoint, token lacking write scope,");
  console.error("or the bucket name not matching R2_BUCKET.");
  process.exit(1);
});
