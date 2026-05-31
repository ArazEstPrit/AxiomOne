import { AsyncLocalStorage } from "async_hooks";
import { randomUUID } from "crypto";
import { getCallSites } from "util";
import {
	EventEmissionRecursionError,
	EventListenerError,
	EventListenerTimeoutError,
} from "./errors.ts";
import type {
	BaseEventListener,
	EmissionOrigin,
	Event,
	EventBusBuilder,
	EventBusMetrics,
	EventEmission,
	EventHandler,
	EventKey,
	EventListener,
	EventListenerOptions,
	EventMap,
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

// meta event listeners don't get run for emissions regarding themselves, i.e. a
// "event-bus:new-listener" listener will not run for its own "new-listener"
// emission.

// meta event listeners are not awaited.

export const RECURSION_LIMIT = 2;
export const LISTENER_TIMEOUT = 500;
export const HISTORY_LIMIT = 20;

const listenerMap = new Map<string, EventListener>();
const inactiveListenerMap = new Map<string, EventListener>();
// TODO rethink emission storage
const eventMap = new Map<EventName, Event>();

const wildcardIndex = new Map<EventWildcard, Set<EventName>>();

const parentStorage = new AsyncLocalStorage<{
	eventStack: EventEmission[];
	runListenerId: string;
}>();

function deStatifyEmission(
	staticEmission: StaticEventEmission,
	stopPropagation: EventEmission["stopPropagation"] = () => {},
): EventEmission {
	return {
		...staticEmission,
		stopPropagation,
		get parent() {
			return staticEmission.parentId
				? deStatifyEmission(getEmission(staticEmission.parentId)!)
				: null;
		},
	};
}

function getEvent<T extends EventName>(eventName: T): Event<T> {
	if (!eventMap.has(eventName)) {
		eventMap.set(eventName, { errors: [], history: [], emissionCount: 0 });
		updateWildcardIndex(eventName);
	}

	return eventMap.get(eventName)! as Event<T>;
}

export function getEmission(id: string): StaticEventEmission | undefined {
	return getHistory().find(e => e.id == id);
}

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
		errors: [],
		lastActivity: null,
		runCount: 0,
		source: getSource(),
	};

	listenerMap.set(id, listener);

	if (!isWildcard(eventKey))
		getEvent(eventKey); // Make sure that this event exists in the eventMap
	else resolveWildcard(eventKey);

	if (options.sticky) {
		const lastStaticEmission = getLastEmission(eventKey);
		if (lastStaticEmission)
			// Sticky listeners are not awaited
			runListener(listener, deStatifyEmission(lastStaticEmission), true);
	}

	emitSync("event-bus:new-listener", listener);

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
): Promise<StaticEventEmission<ResolveWildcard<T>>> {
	return new Promise((res, rej) => {
		if (options?.timeout)
			setTimeout(() => rej(new Error("Timeout")), options?.timeout);

		listen(eventKey, res, {
			once: true,
			filter: options?.filter,
			sticky: options?.sticky,
		});
	});
}

export function once<T extends EventKey>(
	eventKey: T,
	handler: EventHandler<T>,
	options?: Omit<EventListenerOptions<T>, "once">,
): EventSubscription {
	return listen(eventKey, handler, { once: true, ...options });
}

export function listeners<T extends EventKey>(
	eventKey: T,
	options?: {
		resolveWildcard?: false;
		inactive?: boolean;
	},
): EventListener<T>[];
export function listeners<T extends EventKey>(
	eventKey: EventKey,
	options?: {
		resolveWildcard?: true;
		inactive?: boolean;
	},
): EventListener<ResolveWildcard<T>>[];
export function listeners(
	eventKey: EventKey,
	options?: {
		/** whether the inputted key and the listeners' keys should be resolved */
		resolveWildcard?: boolean;
		inactive?: boolean;
	},
): EventListener[] {
	return listenerMap
		.values()
		.toArray()
		.concat(options?.inactive ? inactiveListenerMap.values().toArray() : [])
		.filter(e =>
			options?.resolveWildcard
				? (
						resolveWildcard(eventKey as EventWildcard) as EventKey[]
					).includes(e.key) ||
					resolveWildcard(e.key).includes(eventKey as EventName)
				: eventKey === e.key,
		);
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
	const listener = listenerMap.has(keyOrId)
		? listenerMap.get(keyOrId)
		: listenerMap
				.values()
				.find(e => e.key === keyOrId && e.handler === handler);

	if (!listener) return;

	emitSync("event-bus:remove-listener", listener);

	inactiveListenerMap.set(listener.id, listener);
	listenerMap.delete(listener.id);
}

export const off = removeListener;

export function removeAllListeners(
	eventKey: EventKey,
	options?: {
		resolveWildcard: boolean;
	},
): void {
	const eventNames: EventName[] =
		isWildcard(eventKey) && options?.resolveWildcard
			? resolveWildcard(eventKey)
			: [eventKey as EventName];

	eventNames.forEach(key =>
		listenerMap
			.values()
			.filter(e => e.key === key)
			.forEach(l => listenerMap.delete(l.id)),
	);
}

export function emit<T extends EventWithPayload>(
	eventName: T,
	payload: EventPayload<T>,
	options?: { sync: boolean },
): Promise<void>;
export function emit<T extends EventWithoutPayload>(
	eventName: T,
	payload?: EventPayload<T>,
	options?: { sync: boolean },
): Promise<void>;
export async function emit<T extends EventName>(
	eventName: T,
	payload?: EventPayload<T>,
	options?: { sync: boolean },
) {
	const event = getEvent(eventName);

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
		const error = new EventEmissionRecursionError(
			parentListenerId!,
			eventStack.at(-1)!.id,
			eventName,
		);
		event.errors.push(error);
		emitSync("event-bus:listener-error", error);

		return;
	}

	const runListeners = [] as EventListener[];
	const id = randomUUID();
	const hrtime = process.hrtime(); // TODO
	const staticEmission = {
		payload: payload || null,
		name: eventName,
		timestamp: hrtime[0] * 1000000 + hrtime[1] / 1000,
		id,
		depth: eventStack.length,
		parentId: eventStack.at(-1)?.id || null,
		runListeners,
		origin,
	} as StaticEventEmission;

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

	for (const listener of listeners) {
		let stopped = false;

		runListeners.push(listener);

		const emission = {
			...staticEmission,
			get parent() {
				return eventStack.at(-1);
			},
			stopPropagation() {
				stopped = true;
			},
		} as EventEmission;

		const context = {
			eventStack: [...eventStack, emission],
			runListenerId: listener.id,
		};

		const fn = () => runListener(listener, emission, options?.sync);

		if (options?.sync) parentStorage.run(context, fn);
		else await parentStorage.run(context, fn);

		if (stopped) break;
	}

	pushWithLimit(event.history, staticEmission);
	event.emissionCount++;
}

export function emitSync<T extends EventWithPayload>(
	eventName: T,
	payload: EventPayload<T>,
): void;
export function emitSync<T extends EventWithoutPayload>(eventName: T): void;
export function emitSync<T extends EventName>(
	eventName: T,
	payload?: EventPayload<T>,
) {
	// A little convoluted to make Typescript happy
	if (payload) emit(eventName, payload, { sync: true });
	else
		emit(
			eventName as EventWithoutPayload,
			null as EventMap[EventWithoutPayload],
			{ sync: true },
		);
}

export function eventNames(): EventName[] {
	return eventMap.keys().toArray();
}

export function getHistory<T extends EventKey = EventKey>(
	eventKey?: T,
): StaticEventEmission<ResolveWildcard<T>>[] {
	return resolveWildcard(eventKey || "*")
		.map(e => getEvent(e).history)
		.flat()
		.sort((e1, e2) => e1.timestamp - e2.timestamp) as StaticEventEmission<
		ResolveWildcard<T>
	>[];
}

export function getLastEmission<T extends EventKey>(
	eventKey: T,
): StaticEventEmission<ResolveWildcard<T>> | null {
	return getHistory(eventKey).at(-1) || null;
}

export function getMetrics(): EventBusMetrics {
	return {
		totalEmissions: eventMap
			.values()
			.reduce((acc, curr) => acc + curr.emissionCount, 0),
		activeListeners: listenerMap.size,
		errors: eventMap
			.values()
			.map(e => e.errors)
			.toArray()
			.flat(),
		history: getHistory(),
		events: eventMap.keys().reduce(
			(acc, name) => {
				(acc[name] as EventMetrics) = getEventMetrics(name);
				return acc;
			},
			{} as EventBusMetrics["events"],
		),
		listeners: listenerMap.keys().reduce(
			(acc, id) => {
				acc[id] = getListenerMetrics(id);
				return acc;
			},
			{} as EventBusMetrics["listeners"],
		),
		inactiveListeners: inactiveListenerMap.keys().reduce(
			(acc, id) => {
				acc[id] = getListenerMetrics(id);
				return acc;
			},
			{} as EventBusMetrics["inactiveListeners"],
		),
	};
}

export function getEventMetrics<T extends EventName>(name: T): EventMetrics<T> {
	const event = getEvent(name);

	return {
		name,
		totalEmissions: event.emissionCount,
		activeListeners: listeners(name).length,
		listeners: listeners(name, { inactive: true }),
		lastActivity: event.history.at(-1)?.timestamp || null,
		history: event.history,
		errors: event.errors,
	};
}

export function getListenerMetrics(id: string): ListenerMetrics {
	const listener = (listenerMap.get(id) ??
		inactiveListenerMap.get(id)) as BaseEventListener;
	return {
		id,
		key: listener.key,
		options: listener.options,
		runCount: listener.runCount,
		source: listener.source,
		errors: listener.errors,
		lastActivity: listener.lastActivity,
	};
}

export function __resetState(): void {
	if (!__test?.active) throw new Error("Not in a testing environment!");

	listenerMap.clear();
	inactiveListenerMap.clear();
	eventMap.clear();
	wildcardIndex.clear();
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
				eventMap.keys().filter(n => n.startsWith(key.slice(0, -1))),
			),
		);
	return Array.from(wildcardIndex.get(key)!) as ResolveWildcard<T>[];
}

function getKeysFor<T extends EventName>(eventName: T): PossibleKeys<T>[] {
	return [
		eventName,
		...(wildcardIndex
			.entries()
			.filter(e => e[1].has(eventName))
			.map(e => e[0])
			.toArray() as PossibleKeys<T>[]),
	];
}

function updateWildcardIndex(name: EventName): void {
	wildcardIndex.keys().forEach(key => {
		if (name.startsWith(key.slice(0, -1)))
			wildcardIndex.get(key)!.add(name);
	});
}

async function runListener<T extends EventKey>(
	listener: EventListener<T>,
	emission: EventEmission<ResolveWildcard<T>>,
	sync?: boolean,
): Promise<void> {
	if (listener.options.filter && !listener.options.filter(emission)) return;

	const handleError = (err: unknown) => {
		const error =
			err instanceof EventListenerError
				? err
				: new EventListenerError(listener.id, emission.id, err);
		listener.errors.push(error);

		try {
			listener.options.onError?.(error, emission);
		} catch (error) {
			// Log and eat the error
		}

		emitSync("event-bus:listener-error", error);
	};

	try {
		if (sync) listener.handler(emission);
		else
			await runWithTimeout(
				async () => listener.handler(emission),
				LISTENER_TIMEOUT,
				new EventListenerTimeoutError(listener.id, emission.id),
			);
	} catch (err) {
		handleError(err);
	}

	listener.runCount++;
	listener.lastActivity = Date.now();
	if (listener.options.once) removeListener(listener.id);
}

async function runWithTimeout(
	fn: () => Promise<void>,
	timeout: number,
	rejection: unknown,
) {
	let timeoutId;
	await Promise.race([
		fn(),
		new Promise(
			(_, rej) =>
				(timeoutId = setTimeout(() => {
					rej(rejection);
				}, timeout)),
		),
	]);
	clearTimeout(timeoutId);
}

function pushWithLimit<T>(arr: T[], val: T, limit: number = HISTORY_LIMIT) {
	arr.push(val);

	if (arr.length > limit) arr.splice(0, arr.length - limit);
}

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
