import type { EventName } from "./types.ts";

export class EventBusError extends Error {}

export class EventListenerError extends EventBusError {
	public id: string;
	public emissionId: string;
	public eventName: EventName;

	constructor(
		id: string,
		emissionId: string,
		eventName: EventName,
		cause: unknown,
	) {
		super();
		this.message = `Event Listener "${id}" threw with the following error: ${cause}`;
		this.id = id;
		this.emissionId = emissionId;
		this.cause = cause;
		this.eventName = eventName;
	}
}

export class EventListenerTimeoutError extends EventListenerError {
	constructor(listenerId: string, emissionId: string, eventName: EventName) {
		super(listenerId, emissionId, eventName, "Listener timeout exceeded");
	}
}

export class EventEmissionRecursionError extends EventListenerError {
	constructor(listenerId: string, emissionId: string, eventName: EventName) {
		super(
			listenerId,
			emissionId,
			eventName,
			`Event "${eventName}" has hit the recursion limit.`,
		);
	}
}
