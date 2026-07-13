// Viewer-request function on the DEFAULT behavior only (never /api/* — that
// matches its own behavior first). Rewrites extensionless paths to the SPA
// shell so client-routed URLs like /dashboard deep-link correctly.
//
// Deliberately NOT CloudFront custom error responses: those apply
// distribution-wide, so a legitimate API 403/404 (e.g. getSession() on an
// expired session) would come back as index.html with a 200 and silently
// break the API client's error handling (docs/deployment.md).
function handler(event) {
	var request = event.request;
	if (!request.uri.includes(".")) {
		request.uri = "/index.html";
	}
	return request;
}
