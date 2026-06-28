// SQS configuration for the audit-export pipeline.
//
// Like Redis (see config/redis.ts), SQS is intentionally OPTIONAL: if
// SQS_AUDIT_QUEUE_URL is unset the audit shipper is disabled and the app runs
// exactly as before (audit rows simply accumulate unexported). This lets a
// single-node dev run skip AWS entirely and switch it on only when wanted.
//
// One client, two environments, no code branching:
//   - DEV: AWS_ENDPOINT_URL points at LocalStack (http://localstack:4566). We
//     also pass throwaway credentials so the SDK's SigV4 signer doesn't try to
//     resolve a real credential chain that doesn't exist locally.
//   - PROD: AWS_ENDPOINT_URL is unset, so the SDK talks to real AWS and resolves
//     credentials from the default chain (the EC2 instance role) — no secrets in
//     env.

import { SQSClient } from "@aws-sdk/client-sqs";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Mirror redis.ts: load .env.dev for native runs when nothing has populated the
// environment yet. dotenv never overrides an already-set var, so this is a no-op
// once database.ts (or the container env) has run.
if (!process.env.supabase && !process.env.SQS_AUDIT_QUEUE_URL) {
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);
	dotenv.config({ path: join(__dirname, "../../../.env.dev") });
}

const QUEUE_URL = process.env.SQS_AUDIT_QUEUE_URL;
const ENDPOINT = process.env.AWS_ENDPOINT_URL; // LocalStack in dev; unset in prod
const REGION = process.env.AWS_REGION ?? "us-east-1";

/** True when the audit queue is configured. Callers branch on this to stay
 *  no-op in single-node/no-AWS mode. */
export const sqsEnabled = Boolean(QUEUE_URL);

/** Resolved audit FIFO queue URL, or null when SQS is disabled. */
export const auditQueueUrl: string | null = QUEUE_URL ?? null;

/** Shared SQS client, or null when SQS is disabled. */
export const sqsClient: SQSClient | null = sqsEnabled
	? new SQSClient(
			ENDPOINT
				? {
						region: REGION,
						endpoint: ENDPOINT,
						// LocalStack accepts any credentials; supply throwaway ones
						// so SigV4 signing doesn't fail resolving a real chain.
						credentials: { accessKeyId: "test", secretAccessKey: "test" },
					}
				: { region: REGION } // prod: default chain (EC2 instance role)
		)
	: null;
