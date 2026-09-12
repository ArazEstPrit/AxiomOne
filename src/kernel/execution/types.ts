export interface ExecutionNode<K extends ExecutionKind = ExecutionKind> {
	id: string;
	kind: ExecutionKind;
	name: string;
	// TODO: origin - also refactor event bus origin

	parentId: string | null;

	attributes: ExecutionNodeAttributes<K>;
}

export interface ExecutionContext {
	readonly stack: readonly ExecutionNode[];
}

export interface ExecutionHandle<K extends ExecutionKind> {
	readonly id: string;
	readonly ended: boolean;
	readonly node: Readonly<ExecutionNode<K>>;

	setAttribute<
		F extends keyof ExecutionNodeAttributes<K>,
		A extends ExecutionNodeAttributes<K>[F],
	>(
		field: F,
		value: A,
	): A;
	end(): void;
	[Symbol.dispose](): void;
}

export interface ExecutionKindMap {
	scope: Record<string, unknown>;
}

export type ExecutionKind = keyof ExecutionKindMap;

export type ExecutionNodeAttributes<K extends ExecutionKind = ExecutionKind> =
	ExecutionKindMap[K];
