export class ActionError extends Error {
	action: string;
	constructor(message: string, action: string, cause?: unknown) {
		super(message, { cause });
		this.name = "ActionError";
		this.action = action;
	}
}

export class ActionNotFoundError extends ActionError {
	constructor(actionName: string) {
		super(`Action "${actionName}" not found`, actionName);
		this.name = "ActionNotFoundError";
	}
}

export class InvalidArgumentError extends ActionError {
	argument: string;
	constructor(action: string, argument: string, message: string) {
		super(
			`Argument ${argument} invalid: ` +
				(message || "(no validation error provided)"),
			action,
			message,
		);
		this.name = "InvalidArgumentError";
		this.argument = argument;
	}
}

export class RequiredArgumentMissingError extends ActionError {
	argument: string;
	constructor(action: string, argument: string) {
		super(`Argument "${argument}" missing`, action);
		this.name = "RequiredArgumentMissingError";
		this.argument = argument;
	}
}
