export class ActionError extends Error {
	action: string;
	constructor(action: string, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "ActionError";
		this.action = action;
	}
}

export class ActionNotFoundError extends ActionError {
	constructor(actionName: string) {
		super(actionName, `Action "${actionName}" not found`);
		this.name = "ActionNotFoundError";
	}
}

export class ActionExecutionError extends ActionError {
	constructor(actionName: string, cause?: unknown) {
		super(
			actionName,
			`Action "${actionName}" threw during execution`,
			cause,
		);
		this.name = "ActionExecutionError";
	}
}

export class ArgumentError extends ActionError {
	argument: string;
	constructor(actionName: string, argument: string, message: string) {
		super(actionName, message);
		this.name = "ArgumentError";
		this.argument = argument;
	}

	setParent(parentName: string) {
		this.argument = parentName + "." + this.argument;
		this.message = this.message.replace(
			/^Argument "[^"]+"/,
			`Argument "${this.argument}"`,
		);
	}
}

export class InvalidArgumentError extends ArgumentError {
	constructor(
		actionName: string,
		argument: string,
		message?: string | false,
	) {
		super(
			actionName,
			argument,
			`Argument "${argument}" invalid: ` +
				(message || "(no validation error provided)"),
		);
		this.name = "InvalidArgumentError";
		if (message) this.cause = message;
	}
}

export class RequiredArgumentMissingError extends ArgumentError {
	constructor(actionName: string, argument: string) {
		super(actionName, argument, `Argument "${argument}" missing`);
		this.name = "RequiredArgumentMissingError";
	}
}
