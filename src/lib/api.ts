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
				account_type: string;
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
};
