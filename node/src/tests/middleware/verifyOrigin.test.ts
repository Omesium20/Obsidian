import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Request } from "express";
import app from "../../app.js";
import { verifyOrigin } from "../../middleware/verifyOrigin.js";
import AuthorizationError from "../../errors/authorizationError.js";

const SECRET = "test-origin-secret";

// The middleware reads ORIGIN_VERIFY_SECRET per-request, so each test sets or
// clears it and afterEach restores the unset (dev/test) default.
afterEach(() => {
	delete process.env.ORIGIN_VERIFY_SECRET;
});

// Minimal req stub: verifyOrigin only calls req.get("x-origin-verify").
const reqWithHeader = (header?: string) =>
	({
		get: (name: string) =>
			name.toLowerCase() === "x-origin-verify" ? header : undefined,
	}) as unknown as Request;

const res = {} as never;

describe("verifyOrigin middleware", () => {
	it("no-ops when ORIGIN_VERIFY_SECRET is unset, even without the header", () => {
		let called = false;
		verifyOrigin(reqWithHeader(undefined), res, () => {
			called = true;
		});
		expect(called).toBe(true);
	});

	it("passes a request with the matching header", () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		let called = false;
		verifyOrigin(reqWithHeader(SECRET), res, () => {
			called = true;
		});
		expect(called).toBe(true);
	});

	it("throws AuthorizationError when the header is missing", () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		expect(() =>
			verifyOrigin(reqWithHeader(undefined), res, () => {})
		).toThrow(AuthorizationError);
	});

	it("throws AuthorizationError on a wrong same-length value", () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		const wrong = "x".repeat(SECRET.length);
		expect(() => verifyOrigin(reqWithHeader(wrong), res, () => {})).toThrow(
			AuthorizationError
		);
	});

	it("throws AuthorizationError on a different-length value (length guard)", () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		expect(() =>
			verifyOrigin(reqWithHeader(SECRET + "-extra"), res, () => {})
		).toThrow(AuthorizationError);
	});
});

// Through the real app: verifies the mount point (/api/v1 guarded, /health
// not) and that the central error handler formats the 403.
describe("verifyOrigin mounted in app", () => {
	let server: Server;
	let baseUrl: string;

	beforeAll(async () => {
		server = app.listen(0);
		await new Promise<void>((resolve) =>
			server.once("listening", resolve)
		);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	afterAll(() => {
		server.close();
	});

	it("rejects /api/v1 requests without the header as a formatted 403", async () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		const resp = await fetch(`${baseUrl}/api/v1/session`);
		expect(resp.status).toBe(403);
		const body = (await resp.json()) as { errorCode?: string };
		expect(body.errorCode).toBe("AUTHORIZATION_ERROR");
	});

	it("lets /api/v1 requests with the header through to the routes", async () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		const resp = await fetch(`${baseUrl}/api/v1/session`, {
			headers: { "x-origin-verify": SECRET },
		});
		// Whatever /session answers for an anonymous caller, it must not be
		// the origin-check 403.
		expect(resp.status).not.toBe(403);
	});

	it("leaves /health unguarded (compose healthcheck sends no header)", async () => {
		process.env.ORIGIN_VERIFY_SECRET = SECRET;
		const resp = await fetch(`${baseUrl}/health`);
		expect(resp.status).toBe(200);
	});

	it("leaves /api/v1 open when the secret is unset", async () => {
		const resp = await fetch(`${baseUrl}/api/v1/session`);
		expect(resp.status).not.toBe(403);
	});
});
