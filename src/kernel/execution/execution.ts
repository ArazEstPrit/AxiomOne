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

export function current(): ExecutionNode | null {
	return storage.getStore()?.stack.at(-1) || null;
}

export function stack(): readonly ExecutionNode[] {
	return storage.getStore()?.stack || [];
}

export function kindStack<K extends ExecutionKind>(
	kind: K,
): readonly ExecutionNode<K>[] {
	return stack().filter(n => n.kind == kind) as ExecutionNode<K>[];
}

export function kindCurrent<K extends ExecutionKind>(
	kind: K,
): ExecutionNode<K> | null {
	return (
		(stack()
			.filter(n => n.kind == kind)
			.at(-1) as ExecutionNode<K>) || null
	);
}

export function begin<K extends ExecutionKind>(
	kind: K,
	name: string,
	attributes: ExecutionNodeAttributes<K>,
): ExecutionHandle {
	const handle = createNode(kind, name, attributes);

	storage.enterWith({ stack: [...stack(), handle.node] });

	return handle;
}

export function run<T, K extends ExecutionKind>(
	kind: K,
	name: string,
	fn: (handle: ExecutionHandle) => T,
	attributes: ExecutionNodeAttributes<K>,
): T {
	const handle = createNode(kind, name, attributes);

	return storage.run({ stack: [...stack(), handle.node] }, () => fn(handle));
}

function createNode(
	kind: ExecutionKind,
	name: string,
	attributes: ExecutionNodeAttributes,
): ExecutionHandle {
	return createHandle(
		Object.freeze({
			id: randomUUID(),
			kind,
			name,
			parentId: current()?.id || null,
			attributes,
		}),
	);
}

function createHandle(node: ExecutionNode): ExecutionHandle {
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
		id: node.id,
		node,
		get ended() {
			return ended;
		},

		end,
		[Symbol.dispose]: end,
	};
}

export function __resetState() {
	storage.disable();
}
