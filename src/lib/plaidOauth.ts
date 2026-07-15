// Handoff storage for Plaid OAuth institutions (Navy Federal, Chase, …).
//
// OAuth banks send the user away to authenticate on the bank's own site, then
// redirect back to /oauth-return — a full page load that wipes all React state.
// Link can only resume if it is re-initialized with the SAME link token that
// started the session, so the call sites stash that token (plus where to send
// the user afterwards) here just before opening Link, and PlaidOauthReturn
// reads it back. sessionStorage is per-tab, which matches the OAuth redirect
// staying in the same tab.

export interface PlaidOauthState {
	/** The link token the interrupted Link session was opened with. */
	token: string;
	/** In-app path to send the user to once the resumed Link flow ends. */
	returnTo: "/onboarding" | "/dashboard";
}

// Exchange result carried back to the onboarding wizard so an institution
// linked via OAuth still shows up in its "connected" list after the reload.
export interface PlaidOauthLinkedInstitution {
	institution_name: string | null;
	accounts: Array<{
		id: number;
		account_name: string;
		type: string;
		subtype: string | null;
		institution_name: string | null;
		last_four: string | null;
	}>;
	transaction_count: number;
}

const STATE_KEY = "obsidian.plaidOauthState";
const RESULT_KEY = "obsidian.plaidOauthResult";

export function stashPlaidOauthState(state: PlaidOauthState): void {
	sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
}

export function readPlaidOauthState(): PlaidOauthState | null {
	try {
		const raw = sessionStorage.getItem(STATE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as PlaidOauthState;
		return typeof parsed.token === "string" ? parsed : null;
	} catch {
		return null;
	}
}

export function clearPlaidOauthState(): void {
	sessionStorage.removeItem(STATE_KEY);
}

export function stashPlaidOauthResult(result: PlaidOauthLinkedInstitution): void {
	sessionStorage.setItem(RESULT_KEY, JSON.stringify(result));
}

export function readPlaidOauthResult(): PlaidOauthLinkedInstitution | null {
	try {
		const raw = sessionStorage.getItem(RESULT_KEY);
		return raw ? (JSON.parse(raw) as PlaidOauthLinkedInstitution) : null;
	} catch {
		return null;
	}
}

export function clearPlaidOauthResult(): void {
	sessionStorage.removeItem(RESULT_KEY);
}
