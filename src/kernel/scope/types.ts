export interface Scope<K extends ScopeKind = ScopeKind> {
	id: string;
	kind: K;
	name: string;

	parentId: string | null;

	attributes: ScopeAttributes<K>;
}

export interface ScopeContext {
	readonly stack: readonly Scope[];
}

export interface ScopeHandle<K extends ScopeKind = ScopeKind> {
	readonly id: string;
	readonly ended: boolean;
	readonly scope: Readonly<Scope<K>>;

	setAttribute<
		F extends keyof ScopeAttributes<K>,
		A extends ScopeAttributes<K>[F],
	>(
		field: F,
		value: A,
	): A;
	end(): void;
	[Symbol.dispose](): void;
}

export interface ScopeKindMap {
	scope: Record<string, unknown>;
}

export type ScopeKind = keyof ScopeKindMap;

export type ScopeAttributes<K extends ScopeKind = ScopeKind> = ScopeKindMap[K];

export type ScopeCallback<T, K extends ScopeKind = ScopeKind> = (
	handle: ScopeHandle<K>,
) => T;
