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

// TODO: cause a type error in action if more arguments have been defined than
// in the actionmap. Same with when calling
// TODO: force optional argument definitions to include `optional` field

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
	AD extends InferArgsDefinition<ArgumentsOf<N>> = InferArgsDefinition<
		ArgumentsOf<N>
	>,
> = BaseAction<N, AD>;

interface BaseAction<
	N extends ActionName,
	AD extends InferArgsDefinition<A>,
	A extends ArgumentsOf<N> = ArgumentsOf<N>,
	U extends ResultOf<N> = ResultOf<N>,
> {
	name: N;
	displayName?: string;
	aliases?: string[];
	description?: string;
	arguments: AD;
	returnType: Awaited<U>["type"];
	execute(
		params: A,
	): U extends Promise<infer T>
		? Promise<inferResultData<T>>
		: inferResultData<U>;
}

export type ActionInfo<N extends ActionName = ActionName> = Omit<
	Action<N>,
	"execute" | "arguments"
> & {
	arguments: {
		// Gonna need to change this to some recursive system once object
		// arguments are added
		[K in keyof Action<N>["arguments"]]: Omit<
			Action<N>["arguments"][K],
			"validate"
		>;
	};
};

type inferResultData<R> = R extends ActionResult ? R["data"] : void;

// Future UIs will need to find a way to provide this subsystem with user data
// in these formats. So for example, the cli might take dates as strings, and
// parse them itself before passing them to the action.
export interface ArgumentTypeMap {
	string: string;
	number: number;
	boolean: boolean;
	date: Date;
	object: Record<string, unknown>;
	array: Array<unknown>;
}

export type ArgumentType = ArgumentTypeMap[keyof ArgumentTypeMap];

type ArgumentName<T = ArgumentType> = {
	[K in keyof ArgumentTypeMap]: T extends ArgumentTypeMap[K] ? K : never;
}[keyof ArgumentTypeMap];

export type Arguments = Record<string, Argument>;

export type Argument<
	T extends ArgumentName = ArgumentName,
	O extends boolean = boolean,
> = T extends "array" ? ArrayArgument : BaseArgument<T, O>;

interface BaseArgument<T extends ArgumentName, O extends boolean> {
	displayName?: string;
	description?: string;
	aliases?: string[];
	type: T;
	optional?: O;
	default?: ArgumentTypeMap[T];
	validate?: (value: ArgumentTypeMap[T]) => boolean | string;
}

export interface ArrayArgument<
	A extends ArgumentName = ArgumentName,
	O extends boolean = boolean,
> extends BaseArgument<"array", O> {
	itemType: A;
}

// TODO
// interface ObjectArgument<
// 	A extends Arguments = Arguments,
// 	O extends boolean = boolean,
// > extends BaseArgument<"object", O> {
// 	fields: A;
// }

// Copied from: https://zirkelc.dev/posts/typescript-how-to-check-for-optional-properties
type IsOptional<T, K extends keyof T> = undefined extends T[K]
	? {} extends Pick<T, K>
		? true
		: false
	: false;

export type InferArgsDefinition<A> = {
	[K in keyof A]-?: InferArgDefinition<A[K], IsOptional<A, K>>;
};

type InferArgDefinition<
	A,
	O extends boolean,
	N extends ArgumentName<A> = ArgumentName<A>,
> = N extends "array"
	? ArrayArgument<ArgumentName<A extends Array<infer K> ? K : never>, O>
	: Argument<N, O>;

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
	data: unknown;
}

export interface VoidActionResult extends BaseActionResult {
	type: "void";
	data: void;
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
