import { deepFreeze, isObject, trycatch } from "#utils";
import {
	ActionExecutionError,
	ActionNotFoundError,
	ArgumentError,
	InvalidArgumentError,
	RequiredArgumentMissingError,
} from "./errors.ts";
import type {
	Action,
	ActionInfo,
	ActionName,
	ActionNameWithNoArgs,
	Argument,
	Arguments,
	ArgumentsOf,
	ArgumentType,
	ResultOf,
} from "./types.ts";

const actionMap = new Map<ActionName, Action>();
const aliasMap = new Map<string, ActionName>();

export function register<N extends ActionName>(action: Action<N>) {
	deepFreeze(action);
	actionMap.set(action.name, action);

	if (action.displayName) aliasMap.set(action.displayName, action.name);
	action.aliases?.forEach(a => aliasMap.set(a, action.name));
}

export function call<const N extends ActionName>(
	actionName: N,
	rawArgs: ArgumentsOf<N>,
): ResultOf<N>;
export function call<const N extends ActionNameWithNoArgs>(
	actionName: N,
	rawArgs?: ArgumentsOf<N>,
): ResultOf<N>;
export function call<const N extends ActionName>(
	actionName: N,
	input?: ArgumentsOf<N>,
): ResultOf<N> {
	const action = actionMap.get(actionName) as Action<N> | undefined;
	if (!action)
		return {
			type: "void",
			success: false,
			error: new ActionNotFoundError(actionName),
		};

	let result;
	try {
		result = action.execute(
			parseArgs(action.arguments as Arguments, input || {}, actionName),
		);
	} catch (err) {
		return {
			type: action.returnType,
			success: false,
			error:
				err instanceof ArgumentError
					? err
					: new ActionExecutionError(actionName, err),
		} as ResultOf<N>;
	}

	if (result instanceof Promise) {
		return result
			.then(res => ({
				type: action.returnType,
				success: true,
				data: res,
			}))
			.catch(err => ({
				type: action.returnType,
				success: false,
				error: new ActionExecutionError(actionName, err),
			})) as ResultOf<N>;
	} else {
		return {
			type: action.returnType,
			success: true,
			data: result,
		} as ResultOf<N>;
	}
}

function parseArgs(
	argDef: Arguments,
	args: Record<string, unknown>,
	actionName: string,
): Record<string, unknown> {
	const out = {} as Record<string, unknown>;

	const provided = (val: unknown) => val !== undefined && val !== null;

	const validate = (def: Argument, val: ArgumentType) =>
		(def.type == "object" && isObject(val)) ||
		(def.type == "array" && Array.isArray(val)) ||
		(def.type == "date" && val instanceof Date) ||
		typeof val == def.type
			? def.validate
				? def.validate(val as never)
				: true
			: "Wrong Type!";

	const parse = (
		name: string,
		val: unknown,
		def:
			| Exclude<Argument, Argument<Record<string, unknown>>>
			| Argument<[]>["items"],
	) => {
		if (provided(val)) {
			const res = trycatch(() =>
				validate(def as Argument, val as ArgumentType),
			);
			if (res === true) return val;
			else
				throw new InvalidArgumentError(
					actionName,
					name,
					res as false | string,
				);
		}

		if (provided(def.default)) return def.default;
		else if (!def.optional)
			throw new RequiredArgumentMissingError(actionName, name);

		return;
	};

	for (const name of Object.keys(argDef)) {
		const def = argDef[name]!;
		switch (def.type) {
			case "string":
			case "number":
			case "boolean":
			case "date":
				out[name] = parse(name, args[name], def);
				break;
			case "object":
				try {
					parse(name, args[name], def);
					out[name] = parseArgs(
						(def as Argument<{}>).fields,
						args[name] as Record<string, unknown>,
						actionName,
					);
				} catch (err) {
					if (err instanceof ArgumentError) err.setParent(name);
					throw err;
				}
				break;
			case "array":
				(args[name] as unknown[])?.forEach((e, i) =>
					parse(name + "[" + i + "]", e, (def as Argument<[]>).items),
				);
				out[name] = parse(name, args[name], def);
		}
	}
	return out;
}

export function getActionInfo<N extends ActionName>(
	name: N,
): ActionInfo<N> | null {
	const action = actionMap.get(name) as Action<N> | undefined;
	if (!action) return null;

	const info = {
		name: action.name,
		arguments: action.arguments,
		returnType: action.returnType,
	} as Record<string, unknown>;
	if (action.displayName) info.displayName = action.displayName;
	if (action.description) info.description = action.description;
	if (action.aliases) info.aliases = action.aliases;

	return deepFreeze(info) as ActionInfo<N>;
}

export function getActionNames(): ActionName[] {
	return actionMap.keys().toArray();
}

export function getAllActionInfo(): ActionInfo[] {
	return getActionNames().map(a => getActionInfo(a)!);
}

export function resolveAlias(alias: string): ActionName | null {
	return actionMap.has(alias as ActionName)
		? (alias as ActionName)
		: aliasMap.get(alias) || null;
}

export function __resetState(): void {
	if (!__test?.active) throw new Error("Not in a testing environment!");
	actionMap.clear();
	aliasMap.clear();
}
