import { ActionError } from "./errors.ts";

/**
 * Maps Action names to arguments and return types. All Actions must exist within the
 * `ActionMap`. Modules can extend this interface like so:
 * ```
 * // src/modules/my-module/index.ts
 * declare module "#kernel/actions" {
 * 	interface ActionMap {
 *		"my-module:my-action": ActionDefinition<{}, VoidActionResult>;
 *		"my-module:my-other-action": ActionDefinition<
 *			{
 *				a: number;
 *				b: string;
 *			},
 *			ItemActionResult<{ c: boolean; d: Date }>
 *		>;
 * 	}
 * }
 * ```
 *
 * Action names should have the following format: `"module-name:action-name"`.
 * Nested namespaces are also supported: `"module-name:ns1:ns2:action-name"`
 *
 * If defining an action with no arguments, provide {} as the argument type.
 * If defining an action with no result, provide VoidActionResult as the result
 * type.
 */
export interface ActionMap {
	"actions:help": ActionDefinition<
		{
			action?: string;
		},
		HelpActionResult
	>;
}

export type ActionDefinition<
	A extends Record<string, unknown>,
	R extends ActionResult | Promise<ActionResult>,
> = { arguments: A; returns: R };

export type ActionName = keyof ActionMap;

export type ArgumentsOf<N extends ActionName = ActionName> =
	ActionMap[N]["arguments"];

export type ResultOf<N extends ActionName = ActionName> =
	ActionMap[N]["returns"];

export type ActionNameWithNoArgs = {
	[K in ActionName]: Record<never, never> extends ArgumentsOf<K> ? K : never;
}[ActionName];

export type Action<
	N extends ActionName = ActionName,
	AD extends Arguments<ArgumentsOf<N>> = Arguments<ArgumentsOf<N>>,
> = BaseAction<N, AD>;

// TODO: make arguments with defaults show up as required in execute()
interface BaseAction<
	N extends ActionName,
	AD extends Arguments<A>,
	A extends ArgumentsOf<N> = ArgumentsOf<N>,
	U extends ResultOf<N> = ResultOf<N>,
> {
	name: N;
	displayName?: string;
	aliases?: string[];
	description?: string;
	arguments: Arguments<A> extends AD ? AD : never;
	returnType: Awaited<U>["type"];
	execute(
		params: A,
	): U extends Promise<infer T>
		? Promise<inferResultData<T>>
		: inferResultData<U>;
}

export type ActionInfo<N extends ActionName = ActionName> = Readonly<
	Omit<Action<N>, "execute">
>;

type inferResultData<R> = R extends ActionResult ? R["data"] : void;

// Future UIs will need to find a way to provide this subsystem with user data
// in these formats. So for example, the cli might take dates as strings, and
// parse them itself before passing them to the action.
interface ArgumentTypeMap {
	string: string;
	number: number;
	boolean: boolean;
	date: Date;
	object: Record<string, unknown>;
	array: Array<unknown>;
}

export type ArgumentType = ArgumentTypeMap[keyof ArgumentTypeMap];

export type ArgumentName<T = ArgumentType> = {
	[K in keyof ArgumentTypeMap]: T extends ArgumentTypeMap[K] ? K : never;
}[keyof ArgumentTypeMap];

// TODO: options/choices
type BaseArgument<
	T extends ArgumentType = ArgumentType,
	O extends boolean = boolean,
> = {
	displayName?: string;
	description?: string;
	aliases?: string[];
	type: ArgumentName<T>;
	optional?: O;
	default?: T;
	validate?: (value: Exclude<T, undefined>) => boolean | string;
} & (O extends true ? { optional: true } : {});

type ArrayArgument<A extends ArgumentType, O extends boolean> = BaseArgument<
	A[],
	O
> & {
	items: Omit<Argument<A, false>, "default" | "optional">;
};

// Normally A should extend Arguments, but doing so angers the typescript gods
type ObjectArgument<
	A extends Record<string, ArgumentType>,
	O extends boolean,
> = Omit<BaseArgument<A, O>, "default"> & {
	fields: Arguments<A>;
};

// Copied from: https://zirkelc.dev/posts/typescript-how-to-check-for-optional-properties
type IsOptional<T, K extends keyof T> = undefined extends T[K]
	? {} extends Pick<T, K>
		? true
		: false
	: false;

export type Arguments<
	A extends Record<string, ArgumentType> = Record<string, ArgumentType>,
> =
	Required<A> extends Record<string, never>
		? Record<string, never>
		: {
				[K in keyof A]-?: Argument<A[K], IsOptional<A, K>>;
			};

export type Argument<
	A extends ArgumentType = ArgumentType,
	O extends boolean = boolean,
> = ({
	[K in Exclude<keyof ArgumentTypeMap, "array" | "object">]: BaseArgument<
		A,
		O
	>;
} & {
	array: ArrayArgument<
		A extends Array<infer K> ? (K extends ArgumentType ? K : never) : never,
		O
	>;
	object: ObjectArgument<
		A extends Record<string, ArgumentType> ? A : never,
		O
	>;
})[ArgumentName<A>];

export type ActionResult<T = unknown> =
	| VoidActionResult
	| ItemActionResult<T>
	| ListActionResult<T>
	| HelpActionResult;

export type AwaitedActionResult<T extends ActionResult> =
	T extends ActionResult<infer T> ? ActionResult<Awaited<T>> : never;

interface BaseActionResult {
	type: string;
	success: boolean;
	error?: ActionError;
	data?: unknown;
}

export interface VoidActionResult extends BaseActionResult {
	type: "void";
	data?: void;
}

export interface ItemActionResult<T> extends BaseActionResult {
	type: "item";
	data: T;
}

export interface ListActionResult<T> extends BaseActionResult {
	type: "list";
	data: T[];
}

export interface HelpActionResult extends BaseActionResult {
	type: "help";
	data: ActionInfo[];
}
