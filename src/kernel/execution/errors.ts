export class ExecutionError extends Error {}

export class ParentExecutionEndError extends ExecutionError {
	constructor() {
		super();
		this.message = "Cannot end parent execution before child";
		this.name = "ParentExecutionEndError";
	}
}
