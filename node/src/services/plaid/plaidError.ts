import { isAxiosError } from "axios";
import type { PlaidError } from "plaid";

// The Plaid SDK is axios-based: when a request fails, the meaningful detail
// (error_type / error_code / error_message / request_id) lives in
// error.response.data, NOT in error.message — which is only axios's generic
// "Request failed with status code 4xx". Pull the Plaid body out so callers can
// log/branch on the actual error_code (e.g. ITEM_LOGIN_REQUIRED, NO_ACCOUNTS).
export const asPlaidError = (e: unknown): PlaidError | null => {
	if (isAxiosError(e) && e.response?.data && typeof e.response.data === "object") {
		const data = e.response.data as Partial<PlaidError>;
		if (typeof data.error_code === "string") return data as PlaidError;
	}
	return null;
};

// True when a balance request failed solely because the institution requires
// the min_last_updated_datetime option (Capital One / ins_128026 and a few
// others). Used to drive a single targeted retry rather than passing the field
// to every institution — most don't accept it and would error differently.
export const requiresMinLastUpdated = (e: unknown): boolean => {
	const plaid = asPlaidError(e);
	return (
		plaid?.error_code === "INVALID_FIELD" &&
		typeof plaid.error_message === "string" &&
		plaid.error_message.includes("min_last_updated_datetime")
	);
};

// True when a balance request was rejected because the requested
// min_last_updated_datetime is newer than the freshest balance the institution
// can offer. The error_message embeds that freshest timestamp, which lets us
// retry against it exactly — see extractMostRecentBalanceDatetime.
export const isBalanceOutOfRange = (e: unknown): boolean =>
	asPlaidError(e)?.error_code === "LAST_UPDATED_DATETIME_OUT_OF_RANGE";

// Pulls the "most recently updated balance <ISO timestamp>" Plaid reports in a
// LAST_UPDATED_DATETIME_OUT_OF_RANGE message, so a retry can ask for exactly
// the balance Plaid already has instead of guessing a lookback. null if absent.
export const extractMostRecentBalanceDatetime = (e: unknown): Date | null => {
	const msg = asPlaidError(e)?.error_message;
	if (typeof msg !== "string") return null;
	const match = /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/.exec(msg);
	if (!match) return null;
	const d = new Date(match[1]);
	return Number.isNaN(d.getTime()) ? null : d;
};

// A flat, log/details-friendly object for the `cause` of an ExternalServiceError.
// Falls back to the raw message for non-Plaid (network) failures.
export const describePlaidError = (e: unknown): Record<string, unknown> => {
	const plaid = asPlaidError(e);
	if (plaid) {
		return {
			error_type: plaid.error_type,
			error_code: plaid.error_code,
			error_message: plaid.error_message,
			request_id: plaid.request_id,
		};
	}
	return { cause: e instanceof Error ? e.message : String(e) };
};
