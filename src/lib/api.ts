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
		categories: Array<{ category: string; total: number }>;
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
		account_name: string;
		institution_name: string | null;
		last_four: string | null;
		owner_id: number;
		owner_first_name: string;
		owner_last_name: string;
	}>;
	my_monthly: Array<{ month: string; income: number; spending: number }>;
	group_monthly: Array<{ month: string; income: number; spending: number }>;
	my_categories: Array<{ category: string; total: number }>;
	group_categories: Array<{ category: string; total: number }>;
};

export type TxPageFilter = "all" | "income" | "spend";

export type TransactionPageResult = {
	transactions: DashboardSummary["group_transactions"];
	total: number;
	page: number;
	pages: number;
	showOwner: boolean;
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

	getSyncStatus: () =>
		request<{ last_synced_at: string | null; is_syncing: boolean }>(
			"/api/v1/plaid/sync-status"
		),

	getDashboardSummary: () =>
		request<DashboardSummary>("/api/v1/dashboard/summary"),

	getTransactionPage: (view: string, page: number, filter: TxPageFilter) =>
		request<TransactionPageResult>(
			`/api/v1/dashboard/transactions?view=${encodeURIComponent(view)}&page=${page}&filter=${filter}`
		),

	getAccountTransactionPage: (accountId: number, page: number, filter: TxPageFilter) =>
		request<AccountTransactionPageResult>(
			`/api/v1/accounts/${accountId}/transactions?page=${page}&filter=${filter}`
		),
};
