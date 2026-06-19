export type DashboardSummary = {
	user: {
		id: number;
		first_name: string;
		last_name: string;
		username: string;
		email: string;
	};
	group: {
		id: number;
		name: string;
		last_synced_at: string | null;
		is_syncing: boolean;
	} | null;
	members: Array<{
		id: number;
		first_name: string;
		last_name: string;
		role: string;
		monthly: Array<{ month: string; income: number; spending: number }>;
		categories: Array<{ month: string; category: string; total: number }>;
		net_worth: Array<{ date: string; net_worth: number }>;
	}>;
	my_accounts: Array<{
		id: number;
		account_name: string;
		type: string;
		subtype: string | null;
		institution_name: string | null;
		last_four: string | null;
		balance_current: number | null;
		balance_available: number | null;
		is_manual: boolean;
		is_joint_declared: boolean;
		is_private: boolean;
	}>;
	group_accounts: Array<{
		id: number;
		account_name: string;
		type: string;
		subtype: string | null;
		institution_name: string | null;
		last_four: string | null;
		balance_current: number | null;
		balance_available: number | null;
		is_manual: boolean;
		is_joint_declared: boolean;
		is_private: boolean;
		owner_id: number;
		owner_first_name: string;
		owner_last_name: string;
	}>;
	my_transactions: Array<{
		id: number;
		transaction_date: string;
		amount: number;
		description: string | null;
		category: string | null;
		merchant_name: string | null;
		entry_method: string;
		account_id: number;
		account_name: string;
		institution_name: string | null;
		last_four: string | null;
	}>;
	group_transactions: Array<{
		id: number;
		transaction_date: string;
		amount: number;
		description: string | null;
		category: string | null;
		merchant_name: string | null;
		entry_method: string;
		account_id: number;
		account_name: string;
		institution_name: string | null;
		last_four: string | null;
		owner_id: number;
		owner_first_name: string;
		owner_last_name: string;
	}>;
	my_monthly: Array<{ month: string; income: number; spending: number }>;
	group_monthly: Array<{ month: string; income: number; spending: number }>;
	my_categories: Array<{ month: string; category: string; total: number }>;
	group_categories: Array<{ month: string; category: string; total: number }>;
	my_net_worth: Array<{ date: string; net_worth: number }>;
	group_net_worth: Array<{ date: string; net_worth: number }>;
};

export type TxPageFilter = "all" | "income" | "spend";

// Timeframe lower bound for the transaction list. "month" = current calendar
// month-to-date (the default); "all" = no bound. Mirrors the server enum.
export type TxRange = "month" | "3m" | "6m" | "1y" | "all";

// Full-set KPI aggregates for the transaction list — summed over every matching
// transaction (all pages), not just the rows on the current page. `sumOut` is a
// positive magnitude. Counts mirror the same filtered set.
export type TransactionPageSummary = {
	total: number;
	sumIn: number;
	sumOut: number;
	countIn: number;
	countOut: number;
};

// One month's totals for the transaction list's section headers. Computed
// server-side over the whole filtered set so each header shows the month's true
// totals, not a sum of the current page. `monthKey` ("2026-06") is the stable key
// the client groups rows by; `month` ("Jun 2026") is the display label.
export type TxMonthlyBucket = {
	month: string;
	monthKey: string;
	sumIn: number;
	sumOut: number;
	net: number;
	count: number;
};

export type TransactionPageResult = {
	transactions: DashboardSummary["group_transactions"];
	total: number;
	page: number;
	pages: number;
	showOwner: boolean;
	summary: TransactionPageSummary;
	monthly: TxMonthlyBucket[];
};

// One recurring outflow stream (subscription/bill) detected by Plaid, as served
// by GET /plaid/recurring. Amounts are positive costs (money leaving the
// account). `frequency` and `status` are Plaid enums (e.g. "MONTHLY", "MATURE").
export type RecurringStream = {
	stream_id: string;
	account_id: number | null;
	account_name: string | null;
	description: string;
	merchant_name: string | null;
	category: string | null;
	frequency: string;
	average_amount: number | null;
	last_amount: number | null;
	first_date: string;
	last_date: string;
	predicted_next_date: string | null;
	status: string;
	// All-time net spend on this stream (positive) and the number of stored
	// charges it was summed from — see recurringService.
	total_spent: number;
	charge_count: number;
};

export type RecurringStreamsResult = {
	streams: RecurringStream[];
	errors: Array<{ itemId: number; message: string }>;
};

// A holder of an account, as served by GET /accounts/:id/members. Used by the
// "manage co-owners" UI and the transfer-on-delete owner picker.
export type AccountMember = {
	id: number;
	account_id: number;
	user_id: number;
	ownership_type: "owner" | "joint" | "authorized_user";
	added_at: string | null;
	first_name: string;
	last_name: string;
};

export type AccountTransactionPageResult = {
	transactions: DashboardSummary["my_transactions"];
	total: number;
	page: number;
	pages: number;
};

type ApiErrorBody = {
	status?: string;
	errorCode?: string;
	message?: string;
	details?: unknown;
};

export class ApiError extends Error {
	status: number;
	errorCode?: string;
	details?: unknown;
	constructor(status: number, body: ApiErrorBody) {
		super(body.message || `Request failed with status ${status}`);
		this.status = status;
		this.errorCode = body.errorCode;
		this.details = body.details;
	}
}

// Keep in sync with INACTIVITY_LIMIT_MS in
// node/src/services/auth/refreshService.ts. The server slides
// refresh_tokens.last_used_at on every authenticated request and expires the
// session after this much inactivity; the client mirrors it so it can log out
// proactively instead of sitting on a stale, already-dead page.
export const INACTIVITY_LIMIT_MS = 30 * 60 * 1000;

type SessionListener = () => void;
let onActivity: SessionListener | null = null;
let onSessionExpired: SessionListener | null = null;

// Registered by the app's protected shell (ProtectedRoute) so the API layer can
// drive the client-side inactivity timer (onActivity — fired on every successful
// request, matching when the server slides last_used_at) and react to a
// server-ended session (onSessionExpired — fired on a 401). Passing {} clears them.
export function setSessionListeners(listeners: {
	onActivity?: SessionListener;
	onSessionExpired?: SessionListener;
}) {
	onActivity = listeners.onActivity ?? null;
	onSessionExpired = listeners.onSessionExpired ?? null;
}

// Payload pushed by the server when a household's Plaid sync finishes (both the
// ~7-hour cron sync and an on-demand POST /plaid/sync). Mirrors publishToGroup
// in node/src/services/realtime/eventBus.ts.
export type SyncCompleteEvent = {
	added: number;
	modified: number;
	removed: number;
	at: string;
};

// Open an SSE stream to /api/v1/events and invoke `onSync` whenever this user's
// household finishes a sync — the cue for the dashboard to refetch its own
// (per-user) summary. EventSource sends the auth cookies automatically and
// auto-reconnects on a dropped connection. Returns an unsubscribe function that
// closes the stream (call it on unmount).
export function subscribeToSync(
	onSync: (data: SyncCompleteEvent) => void
): () => void {
	const es = new EventSource("/api/v1/events", { withCredentials: true });
	es.addEventListener("sync:complete", (e) => {
		try {
			onSync(JSON.parse((e as MessageEvent).data) as SyncCompleteEvent);
		} catch {
			// Malformed payload — ignore rather than crash the handler.
		}
	});
	return () => es.close();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		credentials: "include",
		...init,
		headers: {
			"Content-Type": "application/json",
			...(init?.headers || {}),
		},
	});

	const text = await res.text();
	const body = text ? (JSON.parse(text) as ApiErrorBody & Record<string, unknown>) : {};

	if (!res.ok) {
		// 401 means the server rejected the session (expired access token with no
		// valid refresh, or an inactivity-revoked refresh token). Let the app tear
		// down the session and redirect rather than leave a broken page up.
		if (res.status === 401) {
			onSessionExpired?.();
		}
		throw new ApiError(res.status, body);
	}

	// A successful authenticated request is "activity" — slide the client timer.
	onActivity?.();
	return body as T;
}

export const api = {
	getSession: () =>
		request<{ userId: number; groupId: number | null; role: string | null }>(
			"/api/v1/session"
		),

	login: (email: string, password: string) =>
		request<{ message: string }>("/api/v1/login", {
			method: "POST",
			body: JSON.stringify({ email, password }),
		}),

	register: (data: {
		email: string;
		password_hash: string;
		username: string;
		first_name: string;
		last_name: string;
	}) =>
		request<{ message: string }>("/api/v1/register/auth/register", {
			method: "POST",
			body: JSON.stringify(data),
		}),

	logout: () =>
		request<{ message: string }>("/api/v1/logout", {
			method: "POST",
		}),

	requestPasswordReset: (email: string) =>
		request<{ message: string }>("/api/v1/password-reset/request", {
			method: "POST",
			body: JSON.stringify({ email }),
		}),

	resetPassword: (token: string, new_password: string) =>
		request<{ message: string }>("/api/v1/password-reset/reset", {
			method: "POST",
			body: JSON.stringify({ token, new_password }),
		}),

	getInvitationPreview: (token: string) =>
		request<{
			inviter_name: string;
			group_name: string;
			invitee_email_masked: string;
			expires_at: string;
		}>(`/api/v1/invitations/preview?token=${encodeURIComponent(token)}`),

	acceptInvitation: (token: string) =>
		request<{ message: string }>("/api/v1/invitations/accept", {
			method: "POST",
			body: JSON.stringify({ token }),
		}),

	declineInvitation: (token: string) =>
		request<{ message: string }>("/api/v1/invitations/decline", {
			method: "POST",
			body: JSON.stringify({ token }),
		}),

	// Update the caller's own display name (first/last). Any logged-in user.
	updateProfile: (first_name: string, last_name: string) =>
		request<{
			message: string;
			user: { id: number; first_name: string; last_name: string };
		}>("/api/v1/users/", {
			method: "PATCH",
			body: JSON.stringify({ first_name, last_name }),
		}),

	// Permanently delete the caller's own account and all associated data. A
	// household creator with other members is rejected server-side until they
	// remove everyone first.
	deleteUser: (id: number) =>
		request<{ message: string }>("/api/v1/users/", {
			method: "DELETE",
			body: JSON.stringify({ id }),
		}),

	// Rename the caller's current group/household. Creator-only (enforced server-side).
	renameGroup: (name: string) =>
		request<{
			message: string;
			group: { id: number; name: string };
		}>("/api/v1/groups/", {
			method: "PATCH",
			body: JSON.stringify({ name }),
		}),

	sendInvitation: (invitee_email: string) =>
		request<{ message: string; invitationId: number | string }>("/api/v1/invitations", {
			method: "POST",
			body: JSON.stringify({ invitee_email }),
		}),

	createLinkToken: () =>
		request<{ link_token: string; expiration: string }>("/api/v1/plaid/link-token", {
			method: "POST",
		}),

	exchangePublicToken: (public_token: string) =>
		request<{
			message: string;
			institution_name: string | null;
			accounts: Array<{
				id: number;
				plaid_account_id: string;
				account_name: string;
				type: string;
				subtype: string | null;
				institution_name: string | null;
				last_four: string | null;
				balance_current: number | null;
				balance_available: number | null;
			}>;
			transaction_count: number;
		}>("/api/v1/plaid/exchange-token", {
			method: "POST",
			body: JSON.stringify({ public_token }),
		}),

	createManualAccount: (data: {
		account_name: string;
		type: string;
		subtype?: string | null;
		institution_name?: string | null;
		last_four?: string | null;
		balance_current?: number | null;
	}) =>
		request<{
			message: string;
			account: {
				id: number;
				account_name: string;
				type: string;
				subtype: string | null;
			};
		}>("/api/v1/accounts/", {
			method: "POST",
			body: JSON.stringify(data),
		}),

	createManualTransaction: (data: {
		account_id: number;
		transaction_date: string;
		amount: number;
		merchant_name: string;
		category?: string | null;
		description?: string | null;
	}) =>
		request<{
			message: string;
			transaction: {
				id: number;
				transaction_date: string;
				amount: number;
				merchant_name: string | null;
				category: string | null;
			};
		}>("/api/v1/transactions/", {
			method: "POST",
			body: JSON.stringify(data),
		}),

	updateTransaction: (
		id: number,
		data: {
			account_id?: number;
			transaction_date?: string;
			amount?: number;
			merchant_name?: string | null;
			category?: string | null;
			description?: string | null;
		}
	) =>
		request<{
			message: string;
			transaction: {
				id: number;
				transaction_date: string;
				amount: number;
				merchant_name: string | null;
				category: string | null;
			};
		}>(`/api/v1/transactions/${id}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		}),

	deleteTransaction: (id: number) =>
		request<{ message: string }>("/api/v1/transactions/", {
			method: "DELETE",
			body: JSON.stringify({ id }),
		}),

	updateManualAccount: (
		id: number,
		data: {
			account_name?: string;
			type?: string;
			subtype?: string | null;
			institution_name?: string | null;
			last_four?: string | null;
			balance_current?: number | null;
		}
	) =>
		request<{
			message: string;
			account: {
				id: number;
				account_name: string;
				type: string;
				subtype: string | null;
			};
		}>(`/api/v1/accounts/${id}`, {
			method: "PATCH",
			body: JSON.stringify(data),
		}),

	// Remove an account. With no co-owners this is a soft delete (history kept;
	// Plaid sync stops). With joint co-owners it transfers ownership instead — to
	// the sole co-owner automatically, or to `new_owner_user_id` when there are
	// several (a 422 with `details.candidates` is returned if the pick is missing).
	deleteAccount: (id: number, new_owner_user_id?: number) =>
		request<{ message: string }>(`/api/v1/accounts/${id}`, {
			method: "DELETE",
			...(new_owner_user_id != null
				? { body: JSON.stringify({ new_owner_user_id }) }
				: {}),
		}),

	// Toggle an account's household visibility: "group" = public (everyone in the
	// household sees it), "private" = only the holders see it on their own views.
	setAccountVisibility: (id: number, visibility: "private" | "group") =>
		request<{ message: string; account_id: number; visibility: string }>(
			`/api/v1/accounts/${id}/visibility`,
			{ method: "PUT", body: JSON.stringify({ visibility }) }
		),

	// Flag/unflag an account as a (user-declared) joint account.
	markAccountJoint: (id: number, value: boolean) =>
		request<{ message: string; account: { id: number; is_joint_declared: boolean } }>(
			`/api/v1/accounts/${id}/joint`,
			{ method: "PUT", body: JSON.stringify({ value }) }
		),

	// List an account's holders (owner + joint co-owners).
	getAccountMembers: (id: number) =>
		request<{ members: AccountMember[] }>(`/api/v1/accounts/${id}/members`),

	// Link an existing household member to this account as a joint co-owner.
	addCoOwner: (id: number, user_id: number) =>
		request<{ message: string; account_id: number; user_id: number }>(
			`/api/v1/accounts/${id}/members`,
			{ method: "POST", body: JSON.stringify({ user_id }) }
		),

	// Remove a co-owner from an account.
	removeCoOwner: (id: number, user_id: number) =>
		request<{ message: string; account_id: number; user_id: number }>(
			`/api/v1/accounts/${id}/members/${user_id}`,
			{ method: "DELETE" }
		),

	triggerSync: () =>
		request<{
			synced: number;
			total: number;
			added: number;
			modified: number;
			removed: number;
			last_synced_at: string | null;
			errors?: Array<{ itemId: number; message: string }>;
		}>("/api/v1/plaid/sync", { method: "POST" }),

	// Recurring outflow streams (subscriptions) for the dashboard panel, scoped
	// to the active view ("me", "group", or "member-{id}").
	getRecurringStreams: (view: string) =>
		request<RecurringStreamsResult>(
			`/api/v1/plaid/recurring?view=${encodeURIComponent(view)}`
		),

	getSyncStatus: () =>
		request<{ last_synced_at: string | null; is_syncing: boolean }>(
			"/api/v1/plaid/sync-status"
		),

	getDashboardSummary: () =>
		request<DashboardSummary>("/api/v1/dashboard/summary"),

	getTransactionPage: (
		view: string,
		page: number,
		filter: TxPageFilter,
		category?: string,
		range: TxRange = "month",
		search?: string
	) =>
		request<TransactionPageResult>(
			`/api/v1/dashboard/transactions?view=${encodeURIComponent(view)}&page=${page}&filter=${filter}&range=${range}` +
				(category ? `&category=${encodeURIComponent(category)}` : "") +
				(search ? `&search=${encodeURIComponent(search)}` : "")
		),

	// Distinct categories available for the given view, for the filter dropdown.
	getTransactionCategories: (view: string) =>
		request<{ categories: string[] }>(
			`/api/v1/dashboard/transactions/categories?view=${encodeURIComponent(view)}`
		),

	getAccountTransactionPage: (accountId: number, page: number, filter: TxPageFilter) =>
		request<AccountTransactionPageResult>(
			`/api/v1/accounts/${accountId}/transactions?page=${page}&filter=${filter}`
		),
};
