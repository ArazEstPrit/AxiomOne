import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { getCallSites } from "util";
import {
	EventEmissionRecursionError,
	EventListenerError,
	EventListenerTimeoutError,
} from "./errors.ts";
import type {
	EmissionOrigin,
	EventBusBuilder,
	EventBusMetrics,
	EventEmission,
	EventHandler,
	EventKey,
	EventListener,
	EventListenerOptions,
	EventMetrics,
	EventName,
	EventPayload,
	EventSubscription,
	EventWildcard,
	EventWithPayload,
	EventWithoutPayload,
	ListenerMetrics,
	PossibleKeys,
	ResolveWildcard,
	StaticEventEmission,
} from "./types.ts";
import { arrMax, mapIncrement, mapPush, runWithTimeout } from "#utils";

export const RECURSION_LIMIT = 2;
export const LISTENER_TIMEOUT = 5000;

const listenerMap = new Map<string, EventListener>();
const wildcardIndex = new Map<EventWildcard, Set<EventName>>([
	// This entry effectively functions as a set of all known events, which is
	// why it should be added manually on initialisation.
	["*", new Set()],
]);

const parentStorage = new AsyncLocalStorage<{
	eventStack: EventEmission[];
	runListenerId: string;
}>();
// Though mapping events to their parent emissions alone, and recursively
// building the stack would be more space efficient, it would not work if the
// same event is present multiple times in a single stack, and would result in
// an infinite loop. (TODO: find a better way)
const lastEmissionStackMap = new Map<EventName, EventEmission[]>();

const listenerErrorMap = new Map<string, EventListenerError[]>();
const counterMap = new Map<string, number>();

export function listen<T extends EventKey>(
	eventKey: T,
	handler: EventHandler<T>,
	options?: EventListenerOptions<T>,
): EventSubscription;
export function listen<T extends EventKey>(eventKey: T): EventBusBuilder<T>;
export function listen(
	eventKey: EventKey,
	handler?: EventHandler<EventKey>,
	options: EventListenerOptions<EventKey> = {},
): EventSubscription | EventBusBuilder {
	if (!handler) return build(eventKey);

	const id = randomUUID();
	const listener: EventListener = {
		key: eventKey,
		handler,
		id,
		options,
		source: getSource(),
	};

	listenerMap.set(id, listener);

	updateWildcardIndex(eventKey);

	if (options.sticky) {
		const lastEmission = getLast(eventKey);
		if (lastEmission)
			// Sticky listeners are not awaited
			runListener(listener, lastEmission, true);
	}

	emit("event-bus:new-listener", listener);

	return {
		id,
		isActive: () => listenerMap.has(id),
		unsubscribe: () => removeListener(id),
	};
}

export function build<T extends EventKey>(eventKey: T): EventBusBuilder<T> {
	const options = {} as EventListenerOptions<T>;

	const fluent: EventBusBuilder<T> = {
		once: () => ((options.once = true), fluent),
		sticky: () => ((options.sticky = true), fluent),
		priority: level => ((options.priority = level), fluent),
		filter: fn => ((options.filter = fn), fluent),
		onError: fn => ((options.onError = fn), fluent),
		listen: fn => listen(eventKey, fn, options),
	};

	return fluent;
}

export const on = listen;

export function waitFor<T extends EventKey>(
	eventKey: T,
	options?: Pick<EventListenerOptions<T>, "sticky" | "filter"> & {
		timeout?: number;
	},
): Promise<EventEmission<ResolveWildcard<T>>> {
	return new Promise((res, rej) => {
		if (options?.timeout)
			// TODO: This timeout error is different than the
			// EventListenerTimeoutError, so a new error class should be made.
			setTimeout(() => rej(new Error("Timeout")), options?.timeout);

		listen(eventKey, res, {
			once: true,
			filter: options?.filter,
			sticky: options?.sticky,
		});
	});
}

export function getLast<T extends EventKey>(
	eventKey: T,
): EventEmission<ResolveWildcard<T>> | null {
	return (
		(arrMax(
			resolveWildcard(eventKey)
				.map(e => lastEmissionStackMap.get(e))
				.filter(e => e !== undefined),
			e => e.at(-1)!.timestamp,
		)?.at(-1) as EventEmission<ResolveWildcard<T>>) || null
	);
}

export function once<T extends EventKey>(
	eventKey: T,
	handler: EventHandler<T>,
	options?: Omit<EventListenerOptions<T>, "once">,
): EventSubscription {
	return listen(eventKey, handler, { once: true, ...options });
}

export function getListener(id: string): EventListener | null {
	return listenerMap.get(id) || null;
}

export function getListeners<T extends EventKey>(
	eventKey: T,
	options?: {
		resolveWildcard?: false;
	},
): EventListener<T>[];
export function getListeners<T extends EventName>(
	eventKey: T,
	options?: {
		resolveWildcard?: true;
	},
): EventListener<PossibleKeys<T>>[];
export function getListeners<T extends EventWildcard>(
	eventKey: T,
	options?: {
		resolveWildcard?: true;
	},
): EventListener<ResolveWildcard<T>>[];
export function getListeners(
	eventKey: EventKey,
	options?: {
		/** whether the inputted key and the listeners' keys should be resolved */
		resolveWildcard?: boolean;
	},
): EventListener[] {
	updateWildcardIndex(eventKey);
	return listenerMap
		.values()
		.filter(e =>
			options?.resolveWildcard
				? resolveWildcard(eventKey).includes(e.key as EventName) ||
					resolveWildcard(e.key).includes(eventKey as EventName)
				: eventKey === e.key,
		)
		.toArray();
}

export function removeListener<T extends EventKey>(
	eventKey: T,
	handler: EventHandler<T>,
): void;
export function removeListener(id: string): void;
export function removeListener<T extends EventKey>(
	keyOrId: T | string,
	handler?: EventHandler<T>,
): void {
	const listener =
		listenerMap.get(keyOrId) ||
		listenerMap
			.values()
			.find(e => e.key === keyOrId && e.handler === handler);

	if (!listener) return;

	emit("event-bus:remove-listener", listener);

	listenerMap.delete(listener.id);
}

export const off = removeListener;

export function removeAllListeners(
	eventKey: EventKey,
	options?: {
		resolveWildcard: boolean;
	},
): void {
	updateWildcardIndex(eventKey);
	const eventNames: EventName[] =
		isWildcard(eventKey) && options?.resolveWildcard
			? resolveWildcard(eventKey)
			: [eventKey as EventName];

	eventNames.forEach(key =>
		listenerMap
			.values()
			.filter(e => e.key === key)
			.forEach(l => removeListener(l.id)),
	);
}

export async function emit<T extends EventWithPayload>(
	eventName: T,
	payload: EventPayload<T>,
): Promise<void>;
export async function emit<T extends EventWithoutPayload>(
	eventName: T,
	payload?: null,
): Promise<void>;
export async function emit<T extends EventName>(
	eventName: T,
	payload?: EventPayload<T>,
): Promise<void> {
	updateWildcardIndex(eventName);

	const eventStack = parentStorage.getStore()?.eventStack || [];
	const parentListenerId = parentStorage.getStore()?.runListenerId;
	const origin: EmissionOrigin = parentListenerId
		? { type: "listener", listenerId: parentListenerId }
		: { source: getSource(), type: "direct" };

	const originatesFromSameListener = (e: StaticEventEmission) =>
		e.origin.type == "listener" &&
		origin.type == "listener" &&
		e.origin.listenerId == origin.listenerId;

	if (
		eventStack.filter(
			e => e.name === eventName && originatesFromSameListener(e),
		).length >= RECURSION_LIMIT
	) {
		emit(
			"event-bus:listener-error",
			new EventEmissionRecursionError(
				parentListenerId!,
				eventStack.at(-1)!.id,
				eventName,
			),
		);

		return Promise.resolve();
	}

	const id = randomUUID();
	const hrtime = process.hrtime(); // TODO
	const staticEmission = {
		payload: payload || null,
		name: eventName,
		timestamp: hrtime[0] * 1000000 + hrtime[1] / 1000,
		id,
		depth: eventStack.length,
		parentId: eventStack.at(-1)?.id || null,
		origin,
	} as StaticEventEmission;

	mapIncrement(counterMap, eventName);

	const sameMetaEventId = (l: EventListener) =>
		!(
			eventName.startsWith("event-bus:") &&
			l.id ===
				(payload as EventPayload<ResolveWildcard<"event-bus:*">>).id
		);

	const listeners = listenerMap
		.values()
		.filter(l => resolveWildcard(l.key).includes(eventName))
		.toArray()
		.sort(
			(l1, l2) => (l2.options.priority || 0) - (l1.options.priority || 0),
		)
		.filter(sameMetaEventId);

	let stopped = false;
	const emission = {
		...staticEmission,
		get parent() {
			return eventStack.at(-1);
		},
		stopPropagation() {
			stopped = true;
		},
	} as EventEmission;

	for (const listener of listeners) {
		const context = {
			eventStack: [...eventStack, emission],
			runListenerId: listener.id,
		};

		await parentStorage.run(context, () => runListener(listener, emission));

		if (stopped) break;
	}

	lastEmissionStackMap.set(eventName, [...eventStack, emission]);
}

export function getEventNames(): EventName[] {
	return wildcardIndex.get("*")!.values().toArray();
}

export function __resetState(): void {
	if (!__test?.active) throw new Error("Not in a testing environment!");

	listenerMap.clear();
	wildcardIndex.clear();
	wildcardIndex.set("*", new Set());

	counterMap.clear();
	listenerErrorMap.clear();
	lastEmissionStackMap.clear();
}

function isWildcard(key: EventKey): key is EventWildcard {
	return key.endsWith("*");
}

function resolveWildcard<T extends EventKey>(key: T): ResolveWildcard<T>[] {
	if (!isWildcard(key)) return [key as ResolveWildcard<T>];

	if (!wildcardIndex.has(key))
		wildcardIndex.set(
			key,
			new Set(
				wildcardIndex
					.get("*")!
					.entries()
					.map(e => e[0])
					.filter(n => n.startsWith(key.slice(0, -1)))
					.toArray(),
			),
		);

	return Array.from(wildcardIndex.get(key)!) as ResolveWildcard<T>[];
}

function updateWildcardIndex(name: EventKey): void {
	// If the "*" set already contains the event name, that means the
	// wildcardIndex has already been updated for that event.
	if (!isWildcard(name) && !wildcardIndex.get("*")!.has(name))
		wildcardIndex.keys().forEach(key => {
			if (name.startsWith(key.slice(0, -1)))
				wildcardIndex.get(key)!.add(name);
		});
}

export function getMetrics(): EventBusMetrics {
	const listeners = getListeners("*", { resolveWildcard: true });
	return {
		emissionCount: getEventNames()
			.map(n => counterMap.get(n) || 0)
			.reduce((acc, curr) => acc + curr, 0),
		listenerCount: listeners.length,
		errors: listenerErrorMap.values().toArray().flat(),
		events: getEventNames().reduce(
			(acc, name) => {
				(acc[name] as EventMetrics) = getEventMetrics(name)!;
				return acc;
			},
			{} as EventBusMetrics["events"],
		),
		listeners: listeners.reduce(
			(acc, listener) => {
				acc[listener.id] = getListenerMetrics(listener);
				return acc;
			},
			{} as EventBusMetrics["listeners"],
		),
	};
}

export function getEventMetrics<T extends EventName>(name: T): EventMetrics<T> {
	const listeners = getListeners(name, { resolveWildcard: true });
	return {
		name,
		emissionCount: counterMap.get(name) || 0,
		listenerCount: listeners.length,
		listeners: listeners,
	};
}

export function getListenerMetrics(id: string): ListenerMetrics | null;
export function getListenerMetrics(listener: EventListener): ListenerMetrics;
export function getListenerMetrics(
	listenerOrId: EventListener | string,
): ListenerMetrics | null {
	const listener =
		typeof listenerOrId == "string"
			? listenerMap.get(listenerOrId)
			: listenerOrId;
	return listener
		? {
				id: listener.id,
				key: listener.key,
				options: listener.options as EventListenerOptions,
				runCount: counterMap.get(listener.id)!,
				source: listener.source,
				errors: listenerErrorMap.get(listener.id) || [],
			}
		: null;
}

async function runListener<T extends EventKey>(
	listener: EventListener<T>,
	emission: EventEmission<ResolveWildcard<T>>,
	sync?: boolean,
): Promise<void> {
	if (listener.options.filter && !listener.options.filter(emission))
		return Promise.resolve();

	if (listener.options.once) removeListener(listener.id);

	const handleError = (err: unknown) => {
		const error =
			err instanceof EventListenerError
				? err
				: new EventListenerError(
						listener.id,
						emission.id,
						emission.name,
						err,
					);

		try {
			listener.options.onError?.(error, emission);
		} catch (error) {
			// TODO: Log and eat the error
		}

		emit("event-bus:listener-error", error);
		mapPush(listenerErrorMap, listener.id, error);
	};

	try {
		if (sync) listener.handler(emission);
		else
			await runWithTimeout(
				async () => listener.handler(emission),
				LISTENER_TIMEOUT,
				new EventListenerTimeoutError(
					listener.id,
					emission.id,
					emission.name,
				),
			).catch(handleError);
	} catch (err) {
		handleError(err);
	}

	mapIncrement(counterMap, listener.id);
}

// TODO: The correct call site is the first one in the array which isn't in
// this file. Instead of hardcoding indices like this, we can just find the
// first call site from a different file
function getSource(): string {
	const callSites = getCallSites();
	// When creating a listener using the builder, the correct call site is at
	// index 3 instead of 2, and index 2 points inside the build function
	const callSite =
		callSites[2]?.scriptId == callSites[0]?.scriptId
			? callSites[3]
			: callSites[2];
	if (!callSite) return "";

	return callSite.scriptName + ":" + callSite.lineNumber;
}
