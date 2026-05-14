import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

// Load .env.test before any modules import — database.ts creates its pool
// at import time, so the connection string must already be on process.env.
dotenv.config({ path: ".env.test" });

export default defineConfig({
	test: {
		globalSetup: "./node/src/tests/globalSetup.ts",
		testTimeout: 60000,
		// Run test files sequentially — all projects share one database,
		// so parallel TRUNCATE/INSERT operations would deadlock.
		fileParallelism: false,
		projects: [
			{
				test: {
					name: "users",
					testTimeout: 60000,
					include: [
						"node/src/tests/repository/userRepository.test.ts",
					],
				},
			},
			{
				test: {
					name: "accounts",
					testTimeout: 60000,
					include: [
						"node/src/tests/repository/accountRepository.test.ts",
					],
				},
			},
			{
				test: {
					name: "groups",
					testTimeout: 60000,
					include: [
						"node/src/tests/repository/groupRepository.test.ts",
					],
				},
			},
			{
				test: {
					name: "transactions",
					testTimeout: 60000,
					include: [
						"node/src/tests/repository/transactionRepository.test.ts",
					],
				},
			},
			{
				test: {
					name: "refreshTokens",
					testTimeout: 60000,
					include: [
						"node/src/tests/repository/refreshTokenRepository.test.ts",
					],
				},
			},
			{
				test: {
					name: "plaidSync",
					testTimeout: 60000,
					include: [
						"node/src/tests/repository/plaidSyncRepository.test.ts",
					],
				},
			},
		],
	},
});
