// create a superset of Error with AppError
class AppError extends Error {
	statusCode: number;
	errorCode: string;
	operational: boolean;
	details?: Record<string, unknown>;
	timestamp: Date;

	// automatically initiated anytime an "Error" object is initiated
	constructor(
		message: string,
		statusCode: number,
		errorCode: string,
		operational = true,
		details?: Record<string, unknown>
	) {
		//allows for writes on instance of new object
		super(message);
		this.statusCode = statusCode;
		this.errorCode = errorCode;
		this.operational = operational;
		this.details = details;
		this.timestamp = new Date();

		Object.setPrototypeOf(this, new.target.prototype);
		this.name = this.constructor.name;
	}
}

export default AppError;
