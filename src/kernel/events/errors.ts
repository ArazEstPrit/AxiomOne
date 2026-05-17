import type { EventName } from "./types.ts";

export class EventBusError extends Error {}

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
}

export class EventListenerTimeoutError extends EventListenerError {
	constructor(listenerId: string, emissionId: string) {
		super(listenerId, emissionId, "Listener timeout exceeded");
	}
}

export class EventEmissionRecursionError extends EventListenerError {
	public eventName: EventName;
	constructor(listenerId: string, emissionId: string, eventName: EventName) {
		super(
			listenerId,
			emissionId,
			`Event "${eventName}" has hit the recursion limit.`,
		);
		this.eventName = eventName;
	}
}
