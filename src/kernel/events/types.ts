import { EventBusError, EventListenerError } from "./errors.ts";

/**
 * Maps event names to payload types. All events must exist within the
 * `EventMap`. Modules can extend this interface like so:
 * ```
 * // src/modules/my-module/index.ts
 * declare module "#kernel/events" {
 * 	interface EventMap {
 * 		"my-module:my-event": { a: string };
 * 		"my-module:my-other-event": { b: number };
 * 	}
 * }
 * ```
 *
 * Event names should have the following format: `"module-name:event-name"`.
 * Nested namespaces are also supported: `"module-name:ns1:ns2:event-name"`
 *
 * When defining an event with no payload, use the `null` type.
 */
export interface EventMap {
	"event-bus:new-listener": EventListener;
	"event-bus:remove-listener": EventListener;
	"event-bus:listener-error": EventListenerError;
}

/** The exact name of an event from {@link EventMap} */
export type EventName = keyof EventMap;

export type EventPayload<T extends EventName = EventName> = EventMap[T];

/** Events that have payloads */
export type EventWithPayload = {
	[K in EventName]: EventPayload<K> extends null ? never : K;
}[EventName];

/** Events that have no payloads */
export type EventWithoutPayload = Exclude<EventName, EventWithPayload>;

/** Checks if a string has a namespace divider */
type HasNoDivider<T extends string> = T extends `${string}:${string}`
	? never
	: T;

/**
 * Generates wildcard string literals based on the given string
 */
export type AddWildcard<T extends string> = T extends `${infer A}:${infer B}`
	? T extends `${A}:${HasNoDivider<B>}`
		? `${A}:*` | "*"
		: `${A}:${AddWildcard<B>}`
	: "*";

/**
 * Resolve wildcard strings into event names
 */
export type ResolveWildcard<T extends EventKey> = T extends `${infer A}*`
	? `${A}${string}` & EventName
	: T;

export type PossibleKeys<T extends EventName = EventName> = T | AddWildcard<T>;

export type EventWildcard = AddWildcard<EventName>;

/**
 * Identifier for selecting events. It may be an exact event name
 * ({@link EventName}), which refers to a single event, or a wildcard pattern
 * ({@link EventWildcard}), which can match one or more events.
 */
export type EventKey = EventName | EventWildcard;

interface BaseEmissionOrigin {
	type: string;
}

interface DirectEmissionOrigin {
	type: "direct";
	source: string;
}

interface ListenerEmissionOrigin extends BaseEmissionOrigin {
	type: "listener";
	listenerId: string;
}

export type EmissionOrigin = DirectEmissionOrigin | ListenerEmissionOrigin;

interface BaseStaticEventEmission<T extends EventName> {
	payload: EventPayload<T>;
	name: T;
	timestamp: number;
	id: string;
	depth: number;
	parentId: string | null;
	runListeners: EventListener[];
	origin: EmissionOrigin;
}

interface BaseEventEmission<
	T extends EventName,
> extends BaseStaticEventEmission<T> {
	/** Stop future listeners from being run */
	stopPropagation: () => void;
	get parent(): EventEmission | null;
}

interface BaseEvent<T extends EventName = EventName> {
	history: StaticEventEmission<T>[];
	errors: EventBusError[];
	emissionCount: number;
}

export type EventHandler<T extends EventKey> = (
	event: EventEmission<ResolveWildcard<T>>,
) => void | Promise<void>;

type ErrorHandler<T extends EventKey> = (
	err: EventListenerError,
	event: EventEmission<ResolveWildcard<T>>,
) => void;

/** @returns whether the listener should run */
type EventFilter<T extends EventKey> = (
	event: EventEmission<ResolveWildcard<T>>,
) => boolean;

export interface EventListenerOptions<T extends EventKey> {
	once?: boolean | undefined;
	sticky?: boolean | undefined;
	priority?: number | undefined;
	filter?: EventFilter<T> | undefined;
	onError?: ErrorHandler<T> | undefined;
}

export interface BaseEventListener<T extends EventKey = EventKey> {
	key: T;
	handler: EventHandler<T>;
	options: EventListenerOptions<T>;
	id: string;
	errors: EventListenerError[];
	lastActivity: number | null;
	runCount: number;
	source: string;
}

export interface EventSubscription {
	id: string;
	unsubscribe(): void;
	isActive(): boolean;
}

// These mapped types ensures that unions of event names are distributed,
// producing `EventEmission<"a"> | EventEmission<"b"> | ...`
// instead of a single `EventEmission<"a" | "b">`. This way, typescript
// correctly narrows the event name in code.

/** Event emission data given to listeners */
export type EventEmission<T extends EventName = EventName> = {
	[K in EventName]: BaseEventEmission<K>;
}[T];

/** Read-only properties of event emissions */
export type StaticEventEmission<T extends EventName = EventName> = {
	[K in EventName]: BaseStaticEventEmission<K>;
}[T];

export type EventListener<T extends EventKey = EventKey> = {
	[K in EventKey]: BaseEventListener<K>;
}[T];

export type Event<T extends EventName = EventName> = {
	[K in EventName]: BaseEvent<K>;
}[T];

export interface EventBusMetrics {
	/** Total emissions across all events */
	totalEmissions: number;

	/** Currently active listeners across all events */
	activeListeners: number;

	/** Last emissions. For each event, only the last 20 are given. */
	history: StaticEventEmission[];

	/** All errors */
	errors: EventBusError[];

	/** Per-event stats */
	events: {
		[K in EventName]: EventMetrics<K>;
	};

	/** Per-listener stats */
	listeners: Record<string, ListenerMetrics>;

	/** Inactive listener stats */
	inactiveListeners: Record<string, ListenerMetrics>;
}

export interface EventMetrics<T extends EventName = EventName> {
	/** Event name */
	name: T;

	/** Total emissions of this event */
	totalEmissions: number;

	/** Active listeners for this event */
	activeListeners: number;

	/** Timestamp of when this event last fired */
	lastActivity: number | null;

	/**
	 * Listener for this event. Some listeners may appear under multiple
	 * events due to their use of wildcards.
	 */
	listeners: EventListener<T>[];

	/** Last 20 emissions. */
	history: BaseStaticEventEmission<T>[];

	/** All errors related to this event */
	errors: (EventListenerError | EventBusError)[];
}

export interface ListenerMetrics<T extends EventKey = EventKey> {
	/** Listener id */
	id: string;

	/** Listener event key */
	key: T;

	/** Listener options */
	options: EventListenerOptions<T>;

	/** How many times this listener ran */
	runCount: number;

	/** Listener source */
	source: string;

	/** Errors thrown by this listener */
	errors: EventListenerError[];

	/** Timestamp of when this listener last ran */
	lastActivity: number | null;
}

export interface EventBusBuilder<T extends EventKey = EventKey> {
	once(): this;
	sticky(): this;
	priority(level: number): this;
	filter(predicate: EventFilter<T>): this;
	onError(handler: ErrorHandler<T>): this;
	listen(handler: EventHandler<T>): EventSubscription;
}
