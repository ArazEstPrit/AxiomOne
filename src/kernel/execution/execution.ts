import { AsyncLocalStorage } from "async_hooks";
import type {
	ExecutionContext,
	ExecutionHandle,
	ExecutionKind,
	ExecutionNode,
	ExecutionNodeAttributes,
} from "./types.ts";
import { randomUUID } from "crypto";
import { ParentExecutionEndError } from "./errors.ts";

const storage = new AsyncLocalStorage<ExecutionContext>();

export function current(): Readonly<ExecutionNode> | null {
	return Object.freeze(storage.getStore()?.stack.at(-1)) || null;
}

export function stack(): readonly Readonly<ExecutionNode>[] {
	return Object.freeze(
		storage.getStore()?.stack.map(n => Object.freeze(n)) || [],
	);
}

export function kindStack<K extends ExecutionKind>(
	kind: K,
): readonly Readonly<ExecutionNode<K>>[] {
	return stack().filter(n => n.kind == kind) as ExecutionNode<K>[];
}

export function kindCurrent<K extends ExecutionKind>(
	kind: K,
): Readonly<ExecutionNode<K>> | null {
	return (
		Object.freeze(
			stack()
				.filter(n => n.kind == kind)
				.at(-1) as ExecutionNode<K>,
		) || null
	);
}

export function begin<K extends ExecutionKind>(
	kind: K,
	name: string,
	attributes: ExecutionNodeAttributes<K>,
): ExecutionHandle<K> {
	const handle = createNode(kind, name, attributes);

	storage.enterWith({ stack: [...stack(), handle.node] });

	return handle;
}

export function run<T, K extends ExecutionKind>(
	kind: K,
	name: string,
	fn: (handle: ExecutionHandle<K>) => T,
	attributes: ExecutionNodeAttributes<K>,
): T {
	const handle = createNode(kind, name, attributes);

	return storage.run({ stack: [...stack(), handle.node] }, () => fn(handle));
}

export function setKindAttribute<
	K extends ExecutionKind,
	F extends keyof ExecutionNodeAttributes<K>,
	A extends ExecutionNodeAttributes<K>[F],
>(kind: K, field: F, value: A): A {
	const node = kindCurrent(kind);
	if (node) node.attributes[field] = value;
	return value;
}

function createNode<K extends ExecutionKind>(
	kind: K,
	name: string,
	attributes: ExecutionNodeAttributes,
): ExecutionHandle<K> {
	return createHandle({
		id: randomUUID(),
		kind,
		name,
		parentId: current()?.id || null,
		attributes,
	} as ExecutionNode<K>);
}

function createHandle<K extends ExecutionKind>(
	node: ExecutionNode<K>,
): ExecutionHandle<K> {
	let ended = false;

	const end = () => {
		if (ended) return;
		if (current()?.id !== node.id) throw new ParentExecutionEndError();

		ended = true;

		storage.enterWith({
			stack: stack().slice(0, -1),
		});
	};

	return {
		get id() {
			return node.id;
		},
		get node() {
			return Object.freeze(node);
		},
		get ended() {
			return ended;
		},

		setAttribute(field, value) {
			node.attributes[field] = value;
			return value;
		},
		end,
		[Symbol.dispose]: end,
	};
}

export function __resetState() {
	storage.disable();
}
