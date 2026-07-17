import type {
	Action,
	ActionInfo,
	ActionName,
	ActionNameWithNoArgs,
	ArgumentsOf,
	ResultOf,
} from "./types.ts";

const actionMap = new Map<ActionName, Action>();
const aliasMap = new Map<string, ActionName>();

export function register<const N extends ActionName>(action: Action<N>): void;
export function register(action: Action) {
	actionMap.set(action.name, action);

	if (action.displayName) aliasMap.set(action.displayName, action.name);
	action.aliases?.forEach(a => aliasMap.set(a, action.name));
}

export function call<const N extends ActionNameWithNoArgs>(
	actionName: N,
	rawArgs?: ArgumentsOf<N>,
): ResultOf<N>;
export function call<const N extends ActionName>(
	actionName: N,
	rawArgs: ArgumentsOf<N>,
): ResultOf<N>;
export function call<const N extends ActionName>(
	actionName: N,
	rawArgs?: ArgumentsOf<N>,
): ResultOf<N> {
	return null as never;
}

export function getActionInfo<N extends ActionName>(
	name: N,
): ActionInfo<N> | null {
	const action = actionMap.get(name) as Action<N> | undefined;
	if (!action) return null;

	return {
		name: action.name,
		displayName: action.displayName,
		description: action.description,
		aliases: action.aliases,
		arguments: action.arguments,
		returnType: action.returnType,
	};
}

export function getActionNames(): ActionName[] {
	return null as never;
}

export function getAllActionInfo(): ActionInfo[] {
	return null as never;
}

export function resolveAlias(alias: string): ActionName {
	return null as never;
}

export function __resetState(): void {
	if (!__test?.active) throw new Error("Not in a testing environment!");
}
