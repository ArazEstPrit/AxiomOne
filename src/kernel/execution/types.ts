export interface ExecutionNode<K extends ExecutionKind = ExecutionKind> {
	readonly id: string;
	readonly kind: ExecutionKind;
	readonly name: string;
	// TODO: origin - also refactor event bus origin

	readonly parentId: string | null;

	readonly attributes: ExecutionNodeAttributes<K>;
}

export interface ExecutionContext {
	readonly stack: readonly ExecutionNode[];
}

export interface ExecutionHandle {
	readonly id: string;
	readonly node: ExecutionNode;

	readonly ended: boolean;

	end(): void;
	[Symbol.dispose](): void;
}

export interface ExecutionKindMap {
	scope: Record<string, unknown>;
}

export type ExecutionKind = keyof ExecutionKindMap;

export type ExecutionNodeAttributes<K extends ExecutionKind = ExecutionKind> =
	Readonly<ExecutionKindMap[K]>;
