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
		throw new ApiError(res.status, body);
	}
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
};
