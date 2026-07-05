import { ActionError } from "./errors.ts";

/**
 * Maps Action names to arguments and return types. All Actions must exist within the
 * `ActionMap`. Modules can extend this interface like so:
 * ```
 * // src/modules/my-module/index.ts
 * declare module "#kernel/actions" {
 * 	interface ActionMap {
 * 		"my-module:my-action": {
 * 			arguments: {};
 * 			returns: VoidActionResult;
 * 		};
 * 		"my-module:my-other-action": {
 * 			arguments: {
 * 				a: number;
 * 				b: string;
 * 			};
 * 			returns: ItemActionResult<{ c: boolean; d: Date }>;
 * 		};
 * 	}
 * }
 * ```
 *
 * Action names should have the following format: `"module-name:action-name"`.
 * Nested namespaces are also supported: `"module-name:ns1:ns2:action-name"`
 */
export interface ActionMap {
	"actions:help": {
		arguments: {
			action?: string;
		};
		returns: HelpActionResult;
	};
}

export type ActionName = keyof ActionMap;

export type ArgumentsOf<N extends ActionName = ActionName> =
	ActionMap[N]["arguments"];

export type ResultOf<N extends ActionName = ActionName> =
	ActionMap[N]["returns"];

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

type inferResultData<R> = R extends ActionResult ? R["data"] : void;

export interface ArgumentTypeMap {
	string: string;
	number: number;
	boolean: boolean;
	date: Date;
	object: Record<string, unknown>;
	array: Array<unknown>;
}

type ArgumentName<T> = {
	[K in ArgumentType]: T extends ArgumentTypeMap[K] ? K : never;
}[ArgumentType];

export type ArgumentType = keyof ArgumentTypeMap;

export type Arguments = Record<string, Argument>;

export type Argument<
	T extends ArgumentType = ArgumentType,
	O extends boolean = boolean,
> = T extends "array" ? ArrayArgument : BaseArgument<T, O>;

interface BaseArgument<T extends ArgumentType, O extends boolean> {
	displayName?: string;
	description?: string;
	aliases?: string[];
	type: T;
	optional?: O;
	default?: ArgumentTypeMap[T];
	validate?: (value: ArgumentTypeMap[T]) => boolean | string;
}

export interface ArrayArgument<
	A extends ArgumentType = ArgumentType,
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
	data: {
		name: string;
		displayName?: string;
		aliases?: string[];
		description?: string;
		arguments: Omit<Argument, "validate">[];
		returnType: ActionResult["type"];
	}[];
}
