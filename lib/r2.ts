// Cloudflare R2 over its S3-compatible API. One lazily-built client per
// instance; config is read at call time (not module load) so the scripts can
// `dotenv` their way to credentials before importing the store.
import { S3Client } from "@aws-sdk/client-s3";

let client: S3Client | null = null;

function env(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `${name} is not set — R2 needs R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET.`,
    );
  }
  return v;
}

export const bucket = () => env("R2_BUCKET");

/** R2's S3 endpoint. `R2_ENDPOINT` overrides it — that exists so the store
 *  can be exercised against a local S3-compatible server (path-style) without
 *  live credentials; production never sets it. */
function endpoint(): string {
  return process.env.R2_ENDPOINT || `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`;
}

export function r2(): S3Client {
  if (client) return client;
  client = new S3Client({
    region: "auto",
    endpoint: endpoint(),
    forcePathStyle: !!process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
    // R2 does not implement the SDK's default "always send a CRC32 trailer"
    // behaviour: leaving it on makes every PUT fail with a signature/checksum
    // error, and leaving response validation on breaks GETs of objects
    // written elsewhere. WHEN_REQUIRED is the S3-compat setting.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return client;
}

/** True when all four R2 vars are present (used by the setup script). */
export const r2Configured = () =>
  !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET);
