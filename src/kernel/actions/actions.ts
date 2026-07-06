import type {
	Action,
	ActionInfo,
	ActionName,
	ArgumentsOf,
	ResultOf,
} from "./types.ts";

export function register<const N extends ActionName>(action: Action<N>) {}

export function call<const N extends ActionName>(
	actionName: N,
	rawArgs: ArgumentsOf<N>,
): ResultOf<N> {
	return null as never;
}

export function getActionInfo<N extends ActionName>(
	name: N,
): ActionInfo<N> | null {
	return null as never;
}

export function getActionNames(): ActionName[] {
	return null as never;
}

export function getAllActionInfo(): ActionInfo[] {
	return null as never;
}
