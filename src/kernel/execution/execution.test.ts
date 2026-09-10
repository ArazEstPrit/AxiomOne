import { initTestGlobal } from "#utils";
import { before, beforeEach, describe, it } from "node:test";
import {
	__resetState,
	begin,
	current,
	kindCurrent,
	kindStack,
	run,
	stack,
} from "./execution.ts";
import {
	deepStrictEqual,
	notStrictEqual,
	ok,
	strictEqual,
	throws,
} from "assert";
import type { ExecutionNode } from "./types.ts";

declare module "#kernel/execution" {
	export interface ExecutionKindMap {
		"test:ignore": unknown;
	}
}

describe("Kernel.Execution", () => {
	before(() => {
		initTestGlobal();
	});

	beforeEach(() => {
		__resetState();
	});

	describe(".current()", () => {
		it("should return null when there is no active execution", () => {
			ok(!current());
		});

		it("should return the current execution node", () => {
			using handle = begin("scope", "test", {});

			strictEqual(current(), handle.node);
		});

		it("should return the innermost execution", () => {
			{
				using _ = begin("scope", "outer", {});
				using inner = begin("scope", "inner", {});

				strictEqual(current(), inner.node);
			}
		});

		it("should return null after the root execution ends", () => {
			using handle = begin("scope", "test", {});

			handle.end();

			ok(!current());
		});
	});

	describe(".stack()", () => {
		it("should return an empty stack when there is no active execution", () => {
			ok(stack().length == 0);
		});

		it("should contain the current execution", () => {
			using handle = begin("scope", "test", {});

			deepStrictEqual(stack(), [handle.node]);
		});

		it("should contain nested executions from root to current", () => {
			using outer = begin("scope", "outer", {});
			using inner = begin("scope", "inner", {});

			deepStrictEqual(stack(), [outer.node, inner.node]);
		});

		it("should restore the parent when a child ends", () => {
			using outer = begin("scope", "outer", {});
			using inner = begin("scope", "inner", {});

			inner.end();

			deepStrictEqual(stack(), [outer.node]);
			strictEqual(current(), outer.node);
		});

		it("should return a readonly snapshot", () => {
			using outer = begin("scope", "outer", {});
			using inner = begin("scope", "inner", {});

			const before = stack();

			inner.end();

			deepStrictEqual(before, [outer.node, inner.node]);
		});
	});

	describe(".kindStack()", () => {
		it("should return an empty stack when there are no executions", () => {
			ok(kindStack("scope").length == 0);
		});

		it("should return executions matching the requested kind", () => {
			using first = begin("scope", "first", {});
			using _ = begin("test:ignore", "ignore", {});
			using second = begin("scope", "second", {});
			using _2 = begin("test:ignore", "ignore", {});
			using _3 = begin("test:ignore", "ignore", {});

			deepStrictEqual(kindStack("scope"), [first.node, second.node]);
		});
	});

	describe(".kindCurrent()", () => {
		it("should return null when there is no matching execution", () => {
			ok(!kindCurrent("scope"));
		});

		it("should return the current execution of the requested kind", () => {
			using _ = begin("scope", "outer", {});
			using inner = begin("scope", "inner", {});

			strictEqual(kindCurrent("scope"), inner.node);
		});

		it("should return the nearest matching execution", () => {
			using _ = begin("scope", "first", {});
			using _2 = begin("test:ignore", "ignore", {});
			using second = begin("scope", "second", {});
			using _3 = begin("test:ignore", "ignore", {});
			using _4 = begin("test:ignore", "ignore", {});

			strictEqual(kindCurrent("scope"), second.node);
		});
	});

	describe(".begin()", () => {
		it("should create an execution node", () => {
			using handle = begin("scope", "test", {});

			ok(!!handle.node && !!handle.id);
		});

		it("should assign a unique id", () => {
			using first = begin("scope", "first", {});
			using second = begin("scope", "second", {});

			notStrictEqual(first.id, second.id);
		});

		it("should preserve the execution kind", () => {
			using handle = begin("scope", "test", {});

			strictEqual(handle.node.kind, "scope");
		});

		it("should preserve the execution name", () => {
			using handle = begin("scope", "my-operation", {});

			strictEqual(handle.node.name, "my-operation");
		});

		it("should preserve attributes", () => {
			const attributes = {
				something: "value",
			};

			using handle = begin("scope", "test", attributes);

			strictEqual(handle.node.attributes, attributes);
		});

		it("should create a root execution when there is no current execution", () => {
			using handle = begin("scope", "root", {});

			ok(!handle.node.parentId);
		});

		it("should create a child of the current execution", () => {
			using parent = begin("scope", "parent", {});
			using child = begin("scope", "child", {});

			strictEqual(child.node.parentId, parent.id);
		});
	});

	describe(".end()", () => {
		it("should remove the execution from the active stack", () => {
			using handle = begin("scope", "test", {});

			strictEqual(current(), handle.node);

			handle.end();

			ok(!current());
		});

		it("should be idempotent", () => {
			using handle = begin("scope", "test", {});

			handle.end();
			handle.end();

			ok(!current());
		});

		it("should mark the handle as ended", () => {
			using handle = begin("scope", "test", {});

			ok(!handle.ended);

			handle.end();

			ok(handle.ended);
		});

		it("should support Symbol.dispose", () => {
			let handle;
			{
				using h = begin("scope", "test", {});
				handle = h;
			}

			ok(!current());
			ok(handle.ended);
		});

		it("should not allow ending a non-current execution", () => {
			using parent = begin("scope", "parent", {});
			using _ = begin("scope", "child", {});

			throws(() => parent.end());
		});
	});

	describe(".run()", () => {
		it("should execute the callback", () => {
			let called = false;

			run(
				"scope",
				"test",
				() => {
					called = true;
				},
				{},
			);

			ok(called);
		});

		it("should make the execution current inside the callback", () => {
			let node: ExecutionNode | null = null;

			run(
				"scope",
				"test",
				() => {
					node = current();
				},
				{},
			);

			ok(node);
			strictEqual((node as ExecutionNode).name, "test");
		});

		it("should end the execution after the callback", () => {
			run(
				"scope",
				"test",
				() => {
					strictEqual(current()?.name, "test");
				},
				{},
			);

			ok(!current());
		});

		it("should restore the parent after the callback", () => {
			using parent = begin("scope", "parent", {});

			run(
				"scope",
				"child",
				() => {
					strictEqual(current()?.name, "child");
				},
				{},
			);

			strictEqual(current(), parent.node);

			parent.end();
		});

		it("should return the callback result", () => {
			const result = run(
				"scope",
				"test",
				() => {
					return 123;
				},
				{},
			);

			strictEqual(result, 123);
		});

		it("should end the execution when the callback throws", () => {
			throws(() =>
				run(
					"scope",
					"test",
					() => {
						throw new Error("boom");
					},
					{},
				),
			);

			ok(!current());
		});
	});

	describe("nested execution", () => {
		it("should create siblings rather than nesting completed executions", () => {
			using parent = begin("scope", "parent", {});

			using first = begin("scope", "first", {});
			first.end();

			using second = begin("scope", "second", {});
			second.end();

			strictEqual(first.node.parentId, parent.id);
			strictEqual(second.node.parentId, parent.id);
		});

		it("should restore the parent after each child completes", () => {
			using parent = begin("scope", "parent", {});

			using first = begin("scope", "first", {});
			first.end();

			strictEqual(current(), parent.node);

			using second = begin("scope", "second", {});
			second.end();

			strictEqual(current(), parent.node);
		});
	});

	describe("async context", () => {
		it("should preserve the current execution across await", async () => {
			using handle = begin("scope", "test", {});

			await Promise.resolve();

			strictEqual(current(), handle.node);

			handle.end();
		});

		it("should preserve nested execution across await", async () => {
			using outer = begin("scope", "outer", {});

			await Promise.resolve();

			using inner = begin("scope", "inner", {});

			await Promise.resolve();

			strictEqual(current(), inner.node);
			deepStrictEqual(stack(), [outer.node, inner.node]);
		});

		// This test only passes if we use `run()` in the promises. Using
		// `begin()` causes the "a" scope to leak into the second promise, and
		// both scopes to leak outside the promises, causing a ParentExecutionEndError
		// when ending the root scope. This is because of how `AsyncLocalStorage.enterWith()`
		// works, and I don't think there is a solution.
		it("should isolate concurrent execution branches", async () => {
			using _ = begin("scope", "root", {});

			const results = await Promise.all([
				(async () =>
					run(
						"scope",
						"a",
						async () => {
							await Promise.resolve();
							return current();
						},
						{},
					))(),
				(async () =>
					run(
						"scope",
						"b",
						async () => {
							await Promise.resolve();
							return current();
						},
						{},
					))(),
			]);

			strictEqual(results[0]?.name, "a");
			strictEqual(results[1]?.name, "b");
		});
	});
});
