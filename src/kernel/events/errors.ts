import type { EventName } from "./types.ts";

export class EventBusError extends Error { }

export class EventListenerError extends EventBusError {
	public id: string;
	public emissionId: string;

	constructor(id: string, emissionId: string, cause: unknown) {
		super();
		this.message = `Event Listener "${id}" threw with the following error: ${cause}`;
		this.id = id;
		this.emissionId = emissionId;
		this.cause = cause;
	}

	[Symbol.for("nodejs.util.inspect.custom")]() {
		return "EventListenerError: " + this.message;
	}
}

export class EventListenerTimeoutError extends EventListenerError {
	constructor(listenerId: string, emissionId: string) {
		super(listenerId, emissionId, "Listener timeout exceeded");
	}
}

export class EventEmissionRecursionError extends EventBusError {
	public eventName: EventName;
	constructor(eventName: EventName) {
		super();
		this.message = `Event "${eventName}" has hit the recursion limit.`;
		this.eventName = eventName;
	}
}
