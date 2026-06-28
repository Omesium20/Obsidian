export { default as AppError } from "./appError.js";
export { default as ValidationError } from "./validationError.js";
export { default as AuthenticationError } from "./authenticationError.js";
export { default as AuthorizationError } from "./authorizationError.js";
export { default as NotFoundError } from "./notFoundError.js";
export { default as ConflictError } from "./conflictError.js";
export { default as DatabaseError } from "./databaseError.js";
export { default as ExternalServiceError } from "./externalServiceError.js";
export { default as RateLimitError } from "./rateLimitError.js";

// Shape of a node-postgres (pg) driver error. Defined here rather than imported
// from @supabase/postgrest-js — that package's PostgrestError is a REST error and
// does NOT declare these pg fields; relying on it meant depending on a hand-edited
// node_modules copy that a clean `npm ci` (Docker/CI) wouldn't reproduce. Only the
// fields the repositories read are declared. Used purely as a type by the
// isPostgresError guard (utils/postgressError.ts).
export interface PostgresError extends Error {
	code?: string;
	constraint?: string;
	column?: string;
	details?: string;
}
