import {
	Action,
	ActionName,
	ArgumentsOf,
	InferArgsDefinition,
	ResultOf,
} from "./types.ts";

export function register<const N extends ActionName>(
	action: Action<N, InferArgsDefinition<ArgumentsOf<N>>>,
) {}

export function call<const N extends ActionName>(
	actionName: N,
	rawArgs: ArgumentsOf<N>,
): ResultOf<N> {
	return null as never;
}

export function getAction<const N extends ActionName>(
	name: N,
): Action<N> | null {
	return null as never;
}

export function getActionNames(): ActionName[] {
	return null as never;
}
