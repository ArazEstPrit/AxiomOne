import { AsyncLocalStorage } from "async_hooks";
import type {
	ScopeContext,
	ScopeHandle,
	ScopeKind,
	Scope,
	ScopeAttributes,
	ScopeCallback,
} from "./types.ts";
import { randomUUID } from "crypto";
import { ParentScopeEndError } from "./errors.ts";
import { log } from "#kernel/log";

declare module "#kernel/log" {
	export interface LogMap {
		"scope:start": { scope: Scope };
		"scope:end": { scopeId: string };
		"scope:attribute-change": {
			scopeId: string;
			field: string;
			value: unknown;
		};
	}
}

const storage = new AsyncLocalStorage<ScopeContext>();

export function currentScope(): Readonly<Scope> | null {
	return Object.freeze(storage.getStore()?.stack.at(-1)) || null;
}

export function scopeStack(): readonly Readonly<Scope>[] {
	return Object.freeze(
		storage.getStore()?.stack.map(n => Object.freeze(n)) || [],
	);
}

export function scopeStackOf<K extends ScopeKind>(
	kind: K,
): readonly Readonly<Scope<K>>[] {
	return scopeStack().filter(n => n.kind == kind) as Scope<K>[];
}

export function currentScopeOf<K extends ScopeKind>(
	kind: K,
): Readonly<Scope<K>> | null {
	return (
		Object.freeze(
			scopeStack()
				.filter(n => n.kind == kind)
				.at(-1) as Scope<K>,
		) || null
	);
}

export function begin<K extends ScopeKind>(
	kind: K,
	name: string,
	attributes: ScopeAttributes<K>,
): ScopeHandle<K>;
export function begin(
	name: string,
	attributes: ScopeAttributes<"scope">,
): ScopeHandle<"scope">;
export function begin(
	kindOrName: ScopeKind | string,
	nameOrAttributes: string | ScopeAttributes,
	attr?: ScopeAttributes,
): ScopeHandle {
	const kind = attr ? kindOrName : "scope",
		name = attr ? nameOrAttributes : kindOrName,
		attributes = attr ? attr : nameOrAttributes;

	const handle = createScope(
		kind as ScopeKind,
		name as string,
		attributes as ScopeAttributes,
	);

	storage.enterWith({ stack: [...scopeStack(), handle.scope] });

	return handle;
}

export function run<T, K extends ScopeKind>(
	kind: K,
	name: string,
	fn: ScopeCallback<T, K>,
	attributes: ScopeAttributes<K>,
): T;
export function run<T, K extends "scope">(
	name: string,
	fn: ScopeCallback<T, K>,
	attributes: ScopeAttributes<K>,
): T;
export function run<T>(
	kindOrName: ScopeKind | string,
	nameOrFn: string | ScopeCallback<T>,
	fnOrAttributes: ScopeCallback<T> | ScopeAttributes,
	attr?: ScopeAttributes,
): T {
	const kind = (attr ? kindOrName : "scope") as ScopeKind,
		name = (attr ? nameOrFn : kindOrName) as string,
		fn = (attr ? fnOrAttributes : nameOrFn) as ScopeCallback<T>,
		attributes = (attr ? attr : fnOrAttributes) as ScopeAttributes;

	const handle = createScope(kind, name, attributes);

	const res = storage.run({ stack: [...scopeStack(), handle.scope] }, () =>
		fn(handle),
	);

	log(50, "scope:end", "Scope ended", { scopeId: handle.id });

	return res;
}

export function setKindAttribute<
	K extends ScopeKind,
	F extends keyof ScopeAttributes<K>,
	A extends ScopeAttributes<K>[F],
>(kind: K, field: F, value: A): A {
	const scope = currentScopeOf(kind);
	if (!scope) return value;

	scope.attributes[field] = value;
	log(50, "scope:attribute-change", `Scope attribute set`, {
		scopeId: scope.id,
		field: field as string,
		value,
	});

	return value;
}

function createScope<K extends ScopeKind>(
	kind: K,
	name: string,
	attributes: ScopeAttributes,
): ScopeHandle<K> {
	return createHandle({
		id: randomUUID(),
		kind,
		name,
		parentId: currentScope()?.id || null,
		attributes,
	} as Scope<K>);
}

function createHandle<K extends ScopeKind>(scope: Scope<K>): ScopeHandle<K> {
	let ended = false;

	const end = () => {
		if (ended) return;
		if (currentScope()?.id !== scope.id) throw new ParentScopeEndError();

		ended = true;

		storage.enterWith({
			stack: scopeStack().slice(0, -1),
		});

		log(50, "scope:end", "Scope ended", { scopeId: scope.id });
	};

	log(50, "scope:start", "Scope started", { scope });

	return {
		get id() {
			return scope.id;
		},
		get scope() {
			return Object.freeze(scope);
		},
		get ended() {
			return ended;
		},

		setAttribute(field, value) {
			scope.attributes[field] = value;

			log(50, "scope:attribute-change", `Scope attribute set`, {
				scopeId: scope.id,
				field: field as string,
				value,
			});

			return value;
		},
		end,
		[Symbol.dispose]: end,
	};
}

export function __resetState() {
	storage.disable();
}
