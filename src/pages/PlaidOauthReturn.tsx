import { useCallback, useEffect, useRef, useState } from "react";
import { usePlaidLink, type PlaidLinkOnSuccess } from "react-plaid-link";
import { useRouter } from "../lib/routerContext";
import { api, ApiError } from "../lib/api";
import { Wordmark } from "../components/Wordmark";
import {
	clearPlaidOauthState,
	readPlaidOauthState,
	stashPlaidOauthResult,
} from "../lib/plaidOauth";

// Landing point for a bank's OAuth redirect (see lib/plaidOauth.ts). Re-opens
// Link with the stashed token + receivedRedirectUri so Plaid resumes the
// session where the user left off, exchanges the public token, then sends the
// user back to the screen that started the flow.
export function PlaidOauthReturn() {
	const { navigate } = useRouter();
	// Read once, lazily — StrictMode's double render must see the same value,
	// so the stash is only cleared when the flow ends, never on read.
	const [oauthState] = useState(readPlaidOauthState);
	const [exchanging, setExchanging] = useState(false);
	const [error, setError] = useState("");

	const returnTo = oauthState?.returnTo ?? "/dashboard";

	const onSuccess = useCallback<PlaidLinkOnSuccess>(
		async (publicToken) => {
			setExchanging(true);
			try {
				const res = await api.exchangePublicToken(publicToken);
				// The onboarding wizard rebuilds its "connected" list from this
				// after the reload; the dashboard refetches on mount and doesn't
				// need it.
				if (returnTo === "/onboarding") {
					stashPlaidOauthResult({
						institution_name: res.institution_name,
						accounts: res.accounts.map((a) => ({
							id: a.id,
							account_name: a.account_name,
							type: a.type,
							subtype: a.subtype,
							institution_name: a.institution_name,
							last_four: a.last_four,
						})),
						transaction_count: res.transaction_count,
					});
				}
				clearPlaidOauthState();
				navigate(returnTo);
			} catch (e) {
				clearPlaidOauthState();
				setError(
					e instanceof ApiError
						? e.message
						: "Couldn't finish connecting that bank. Please try again."
				);
				setExchanging(false);
			}
		},
		[navigate, returnTo]
	);

	const onExit = useCallback(() => {
		clearPlaidOauthState();
		navigate(returnTo);
	}, [navigate, returnTo]);

	const { open, ready } = usePlaidLink({
		token: oauthState?.token ?? null,
		receivedRedirectUri: window.location.href,
		onSuccess,
		onExit,
	});

	// Resume Link the moment it's ready. The ref guards against StrictMode's
	// double effect run (and later `ready` flips) re-opening it.
	const openedRef = useRef(false);
	useEffect(() => {
		if (ready && oauthState && !openedRef.current) {
			openedRef.current = true;
			open();
		}
	}, [ready, oauthState, open]);

	// Nothing stashed — a direct visit or a different tab; nothing to resume.
	useEffect(() => {
		if (!oauthState) navigate("/dashboard");
	}, [oauthState, navigate]);

	return (
		<div className="ob-shell">
			<header className="ob-top">
				<Wordmark size="sm" />
			</header>

			<main className="ob-main">
				<section className="ob-card">
					<h1 className="ob-h1">Finishing your bank connection</h1>
					<p className="ob-sub">
						{error
							? "Something went wrong while importing your accounts."
							: exchanging
							? "Importing your accounts…"
							: "Picking up where you left off with your bank…"}
					</p>

					{error ? <div className="field-error">{error}</div> : null}

					{error ? (
						<div className="ob-actions">
							<button className="btn btn-brand" onClick={() => navigate(returnTo)}>
								Continue
							</button>
						</div>
					) : null}
				</section>
			</main>
		</div>
	);
}
