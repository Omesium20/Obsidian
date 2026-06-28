import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// SQS (FIFO) -> S3 audit archiver.
//
// Triggered by an SQS event-source mapping on audit-export.fifo. Each record's
// body is one serialized audit_log row (see auditShipperService). The handler
// writes each row to S3 under a deterministic, record-grouped key and reports
// per-message failures back to SQS so only the failures retry (and, past the
// queue's maxReceiveCount, land in the DLQ).
//
// The AWS SDK v3 reads AWS_ENDPOINT_URL natively. LocalStack injects it into the
// Lambda environment, so this client targets LocalStack in dev and real AWS in
// prod with no code change. Region/credentials likewise come from the runtime
// environment.
const s3 = new S3Client({});
const BUCKET = process.env.AUDIT_BUCKET;

// Deterministic S3 key from the audit row's own immutable fields:
//
//   <table>/<record_id>/<changed_at>-<id>.json
//
// - Grouping by table + record_id puts every change to one record under a single
//   prefix; the changed_at prefix makes `ls` of that prefix a sorted history.
// - The audit row id makes the key unique per event AND idempotent: a duplicate
//   delivery of the same row (the at-least-once resend, or an SQS redelivery)
//   overwrites the identical object instead of creating a second copy. The key
//   is derived ONLY from the row's stable fields — never from processing time —
//   so determinism holds even for a redelivery hours later.
function buildKey(audit) {
	return `${audit.table_name}/${audit.record_id}/${audit.changed_at}-${audit.id}.json`;
}

export const handler = async (event) => {
	const batchItemFailures = [];

	for (const record of event.Records) {
		try {
			const audit = JSON.parse(record.body);
			await s3.send(
				new PutObjectCommand({
					Bucket: BUCKET,
					Key: buildKey(audit),
					Body: record.body, // store the original message verbatim
					ContentType: "application/json",
				})
			);
		} catch (err) {
			console.error(
				`[audit-archiver] failed to archive message ${record.messageId}`,
				err
			);
			// ReportBatchItemFailures contract: name only the messages that
			// failed. SQS keeps them in flight to retry; everything not listed is
			// deleted. With a FIFO source this preserves per-group ordering.
			batchItemFailures.push({ itemIdentifier: record.messageId });
		}
	}

	return { batchItemFailures };
};
