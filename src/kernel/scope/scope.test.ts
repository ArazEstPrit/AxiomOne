import { initTestGlobal } from "#utils";
import { before, beforeEach, describe, it } from "node:test";
import {
	__resetState,
	begin,
	currentScope,
	currentScopeOf,
	scopeStackOf,
	run,
	setKindAttribute,
	scopeStack,
	onScopeAttributeChange,
	onScopeStart,
	onScopeEnd,
} from "./scope.ts";
import {
	deepStrictEqual,
	notStrictEqual,
	ok,
	strictEqual,
	throws,
} from "assert";
import type { Scope } from "./types.ts";

declare module "#kernel/scope" {
	export interface ScopeKindMap {
		"test:ignore": Record<string, unknown>;
	}
}

describe.only("Kernel.Execution", () => {
	before(() => {
		initTestGlobal();
	});

	beforeEach(() => {
		__resetState();
	});

	describe(".current()", () => {
		it("should return null when there is no active scope", () => {
			ok(!currentScope());
		});

		it("should return the current scope", () => {
			using handle = begin("test", {});

			strictEqual(currentScope(), handle.scope);
		});

		it("should return the innermost scope", () => {
			{
				using _ = begin("outer", {});
				using inner = begin("inner", {});

				strictEqual(currentScope(), inner.scope);
			}
		});

		it("should return null after the root scope ends", () => {
			using handle = begin("test", {});

			handle.end();

			ok(!currentScope());
		});
	});

	describe(".stack()", () => {
		it("should return an empty stack when there is no active scope", () => {
			ok(scopeStack().length == 0);
		});

		it("should contain the current scope", () => {
			using handle = begin("test", {});

			deepStrictEqual(scopeStack(), [handle.scope]);
		});

		it("should contain nested scopes from root to current", () => {
			using outer = begin("outer", {});
			using inner = begin("inner", {});

			deepStrictEqual(scopeStack(), [outer.scope, inner.scope]);
		});

		it("should restore the parent when a child ends", () => {
			using outer = begin("outer", {});
			using inner = begin("inner", {});

			inner.end();

			deepStrictEqual(scopeStack(), [outer.scope]);
			strictEqual(currentScope(), outer.scope);
		});

		it("should return a readonly snapshot", () => {
			using outer = begin("outer", {});
			using inner = begin("inner", {});

			const before = scopeStack();

			inner.end();

			deepStrictEqual(before, [outer.scope, inner.scope]);
		});
	});

	describe(".kindStack()", () => {
		it("should return an empty stack when there are no scopes", () => {
			ok(scopeStackOf("scope").length == 0);
		});

		it("should return scopes matching the requested kind", () => {
			using first = begin("scope", "first", {});
			using _ = begin("test:ignore", "ignore", {});
			using second = begin("scope", "second", {});
			using _2 = begin("test:ignore", "ignore", {});
			using _3 = begin("test:ignore", "ignore", {});

			deepStrictEqual(scopeStackOf("scope"), [first.scope, second.scope]);
		});
	});

	describe(".kindCurrent()", () => {
		it("should return null when there is no matching scope", () => {
			ok(!currentScopeOf("scope"));
		});

		it("should return the current scope of the requested kind", () => {
			using _ = begin("outer", {});
			using inner = begin("inner", {});

			strictEqual(currentScopeOf("scope"), inner.scope);
		});

		it("should return the nearest matching scope", () => {
			using _ = begin("scope", "first", {});
			using _2 = begin("test:ignore", "ignore", {});
			using second = begin("scope", "second", {});
			using _3 = begin("test:ignore", "ignore", {});
			using _4 = begin("test:ignore", "ignore", {});

			strictEqual(currentScopeOf("scope"), second.scope);
		});
	});

	describe(".begin()", () => {
		it("should create a scope", () => {
			using handle = begin("test", {});

			ok(!!handle.scope && !!handle.id);
		});

		it("should assign a unique id", () => {
			using first = begin("first", {});
			using second = begin("second", {});

			notStrictEqual(first.id, second.id);
		});

		it("should preserve the scope kind", () => {
			using handle = begin("test", {});

			strictEqual(handle.scope.kind, "scope");
		});

		it("should preserve the scope name", () => {
			using handle = begin("my-operation", {});

			strictEqual(handle.scope.name, "my-operation");
		});

		it("should preserve attributes", () => {
			const attributes = {
				something: "value",
			};

			using handle = begin("test", attributes);

			strictEqual(handle.scope.attributes, attributes);
		});

		it("should create a root scope when there is no current scope", () => {
			using handle = begin("root", {});

			ok(!handle.scope.parentId);
		});

		it("should create a child of the current scope", () => {
			using parent = begin("parent", {});
			using child = begin("child", {});

			strictEqual(child.scope.parentId, parent.id);
		});

		it("should, when kind is not specified, create a 'scope' scope", () => {
			using scope = begin("unspecified", {});

			strictEqual(scope.scope.kind, "scope");
		});

		describe(".setAttribute()", () => {
			it("should set the specified attribute", () => {
				using handle = begin("test", { a: 1 });

				handle.setAttribute("a", 2);
				strictEqual(handle.scope.attributes.a, 2);

				handle.setAttribute("b", 3);
				strictEqual(handle.scope.attributes.b, 3);
			});

			it("should return the attribute", () => {
				using handle = begin("test", { a: 1 });

				strictEqual(handle.setAttribute("a", 2), 2);
			});
		});

		describe(".end()", () => {
			it("should remove the scope from the active stack", () => {
				using handle = begin("test", {});

				strictEqual(currentScope(), handle.scope);

				handle.end();

				ok(!currentScope());
			});

			it("should be idempotent", () => {
				using handle = begin("test", {});

				handle.end();
				handle.end();

				ok(!currentScope());
			});

			it("should mark the handle as ended", () => {
				using handle = begin("test", {});

				ok(!handle.ended);

				handle.end();

				ok(handle.ended);
			});

			it("should support Symbol.dispose", () => {
				let handle;
				{
					using h = begin("test", {});
					handle = h;
				}

				ok(!currentScope());
				ok(handle.ended);
			});

			it("should not allow ending a non-current scope", () => {
				using parent = begin("parent", {});
				using _ = begin("child", {});

				throws(() => parent.end());
			});
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

		it("should make the scope current inside the callback", () => {
			let scope: Scope | null = null;

			run(
				"scope",
				"test",
				() => {
					scope = currentScope();
				},
				{},
			);

			ok(scope);
			strictEqual((scope as Scope).name, "test");
		});

		it("should end the scope after the callback", () => {
			run(
				"scope",
				"test",
				() => {
					strictEqual(currentScope()?.name, "test");
				},
				{},
			);

			ok(!currentScope());
		});

		it("should restore the parent after the callback", () => {
			using parent = begin("parent", {});

			run(
				"scope",
				"child",
				() => {
					strictEqual(currentScope()?.name, "child");
				},
				{},
			);

			strictEqual(currentScope(), parent.scope);

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

		it("should end the scope when the callback throws", () => {
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

			ok(!currentScope());
		});

		it("should, when kind is not specified, create a 'scope' scope", () => {
			run(
				"unspecified",
				handle => {
					strictEqual(handle.scope.kind, "scope");
				},
				{},
			);
		});
	});

	describe(".setKindAttribute()", () => {
		it("should set the attribute of the current scope of the kind", () => {
			using _ = begin("scope", "test", { a: 1 });
			using _2 = begin("test:ignore", "test", {});

			setKindAttribute("scope", "a", 2);

			strictEqual(currentScopeOf("scope")!.attributes.a, 2);
		});

		it("should return the attribute", () => {
			using _ = begin("test", { a: 1 });
			strictEqual(setKindAttribute("scope", "a", 2), 2);
		});
	});

	describe("nested scopes", () => {
		it("should create siblings rather than nesting completed scopes", () => {
			using parent = begin("parent", {});

			using first = begin("first", {});
			first.end();

			using second = begin("second", {});
			second.end();

			strictEqual(first.scope.parentId, parent.id);
			strictEqual(second.scope.parentId, parent.id);
		});

		it("should restore the parent after each child completes", () => {
			using parent = begin("parent", {});

			using first = begin("first", {});
			first.end();

			strictEqual(currentScope(), parent.scope);

			using second = begin("second", {});
			second.end();

			strictEqual(currentScope(), parent.scope);
		});
	});

	describe("async context", () => {
		it("should preserve the current scope across await", async () => {
			using handle = begin("test", {});

			await Promise.resolve();

			strictEqual(currentScope(), handle.scope);

			handle.end();
		});

		it("should preserve nested scopes across await", async () => {
			using outer = begin("outer", {});

			await Promise.resolve();

			using inner = begin("inner", {});

			await Promise.resolve();

			strictEqual(currentScope(), inner.scope);
			deepStrictEqual(scopeStack(), [outer.scope, inner.scope]);
		});

		// This test only passes if we use `run()` in the promises. Using
		// `begin()` causes the "a" scope to leak into the second promise, and
		// both scopes to leak outside the promises, causing a ParentScopeEndError
		// when ending the root scope. This is because of how
		// `AsyncLocalStorage.enterWith()` works, and I don't think there is a
		// solution.
		it("should isolate concurrent scope branches", async () => {
			using _ = begin("root", {});

			const results = await Promise.all([
				(async () =>
					run(
						"scope",
						"a",
						async () => {
							await Promise.resolve();
							return currentScope();
						},
						{},
					))(),
				(async () =>
					run(
						"scope",
						"b",
						async () => {
							await Promise.resolve();
							return currentScope();
						},
						{},
					))(),
			]);

			strictEqual(results[0]?.name, "a");
			strictEqual(results[1]?.name, "b");
		});
	});

	describe(".onScopeStart()", () => {
		it("should run handler when a scope starts", () => {
			const scopes = [] as Scope[];

			onScopeStart(scope => scopes.push(scope));

			let scope1;
			run(
				"test",
				({ scope }) => {
					scope1 = scope;
				},
				{},
			);

			using handle = begin("test", {});
			handle.end();

			deepStrictEqual(scopes, [scope1, handle.scope]);
		});

		it("should run handler right before a scope starts", () => {
			let currentId;
			onScopeStart(() => (currentId = currentScope()?.id));

			using handle = begin("test", {});
			handle.end();

			ok(currentId !== handle.id);
		});
	});

	describe(".onScopeEnd()", () => {
		it("should run handler when a scope ends", () => {
			const scopes = [] as string[];

			onScopeEnd(scopeId => scopes.push(scopeId));

			using handle = begin("test", {});

			let scope1Id;
			run(
				"test",
				({ scope }) => {
					scope1Id = scope.id;
				},
				{},
			);

			handle.end();

			deepStrictEqual(scopes, [scope1Id, handle.id]);
		});

		it("should run handler right after a scope ends", () => {
			let currentId;
			onScopeEnd(() => (currentId = currentScope()?.id));

			using handle = begin("test", {});
			handle.end();

			ok(currentId !== handle.id);
		});
	});

	describe(".onScopeAttributeChange()", () => {
		it("should run handler when an attribute is set", () => {
			const changes = [] as unknown[];

			onScopeAttributeChange((id, field, value) => {
				changes.push({ id, field, value });
			});

			using scope1 = begin("test:ignore", "test", {});
			using scope2 = begin("test", {});

			setKindAttribute("test:ignore", "a", 123);
			scope2.setAttribute("b", 321);

			deepStrictEqual(changes, [
				{ id: scope1.id, field: "a", value: 123 },
				{ id: scope2.id, field: "b", value: 321 },
			]);
		});
	});
});
