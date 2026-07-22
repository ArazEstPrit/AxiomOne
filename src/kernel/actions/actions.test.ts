import { describe, it, before, beforeEach } from "node:test";
import {
	__resetState,
	call,
	getActionInfo,
	getActionNames,
	getAllActionInfo,
	register,
	resolveAlias,
} from "./actions.ts";
import type {
	ActionDefinition,
	ItemActionResult,
	VoidActionResult,
} from "./types.ts";
import { deepStrictEqual, ok, strictEqual } from "assert";
import { initTestGlobal } from "#utils";
import {
	ActionError,
	ActionNotFoundError,
	RequiredArgumentMissingError,
} from "./errors.ts";

declare module "#kernel/actions" {
	interface ActionMap {
		"test:actions:dummy": ActionDefinition<{}, VoidActionResult>;
		"test:actions:params": ActionDefinition<
			{ a: number },
			VoidActionResult
		>;
		"test:actions:optional": ActionDefinition<
			{ a?: number },
			VoidActionResult
		>;
		"test:actions:result": ActionDefinition<{}, ItemActionResult<string>>;
		"test:actions:async": ActionDefinition<
			{},
			Promise<ItemActionResult<number>>
		>;
		"test:actions:object": ActionDefinition<
			{
				a: {
					a?: number;
					b: number;
				};
				b?: {
					a: number;
					b?: number;
				};
			},
			VoidActionResult
		>;
		"test:actions:array": ActionDefinition<
			{
				a: number[];
				b?: number[];
			},
			VoidActionResult
		>;
		"test:actions:nested": ActionDefinition<
			{
				a: {
					a?: number;
					b: number;
				}[];
			},
			VoidActionResult
		>;
	}
}

describe("Kernel.Actions", () => {
	before(() => {
		initTestGlobal();
	});

	beforeEach(() => {
		__resetState();
	});

	describe(".register()", () => {
		it("should register action", () => {
			register({
				name: "test:actions:dummy",
				arguments: {},
				returnType: "void",
				execute() {},
			});

			ok(getActionInfo("test:actions:dummy"));
		});

		// Do we want this? Ignoring re-registers could be limiting (how?), and
		// overriding would allow stuff like a module wrapping another module's
		// action by overriding it, but shouldn't that be an explicit part of
		// the API, instead of a side effect? Having a dedicated wrap function
		// would provide better traceability, or maybe said traceability should
		// be done by this function (i.e. the subsystem remembers overridden
		// actions)
		it("should override action on re-register", () => {
			register({
				name: "test:actions:dummy",
				description: "1",
				arguments: {},
				returnType: "void",
				execute() {},
			});
			register({
				name: "test:actions:dummy",
				description: "2",
				arguments: {},
				returnType: "void",
				execute() {},
			});

			strictEqual(getActionInfo("test:actions:dummy")?.description, "2");
		});
	});

	describe(".call()", () => {
		it("should trigger action handler", () => {
			let run = false;
			register({
				name: "test:actions:dummy",
				arguments: {},
				returnType: "void",
				execute() {
					run = true;
				},
			});

			call("test:actions:dummy");
			ok(run);
		});

		it("should handle throwing handler and return error", () => {
			register({
				name: "test:actions:dummy",
				arguments: {},
				returnType: "void",
				execute() {
					throw "oops";
				},
			});

			const res = call("test:actions:dummy");
			ok(!res.success);
			ok(res.error && res.error instanceof ActionError);
			strictEqual(res.error.cause, "oops");
		});

		it("should return action result promise if action is async", async () => {
			register({
				name: "test:actions:async",
				arguments: {},
				returnType: "item",
				async execute() {
					await new Promise<void>(res => setTimeout(res, 300));
					return 3;
				},
			});

			const res = call("test:actions:async");

			ok(res instanceof Promise);
			const awaited = await res;
			strictEqual(awaited.data, 3);
		});

		it("should return action result", () => {
			register({
				name: "test:actions:result",
				arguments: {},
				returnType: "item",
				execute() {
					return "lol";
				},
			});

			const res = call("test:actions:result");
			ok(res);
			ok(res.success);
			deepStrictEqual(res.data, "lol");
		});

		it("should return error if action doesn't exist", () => {
			const res = call("test:actions:dummy");

			ok(!res.success);
			ok(res.error && res.error instanceof ActionNotFoundError);
		});

		it("should pass parameters to action handler", () => {
			let b;
			register({
				name: "test:actions:params",
				arguments: { a: { type: "number" } },
				returnType: "void",
				execute(params) {
					b = params.a;
				},
			});

			call("test:actions:params", { a: 3 });
			strictEqual(b, 3);
		});

		it("should not trigger handler if required parameters aren't provided", () => {
			let run = false;
			register({
				name: "test:actions:params",
				arguments: { a: { type: "number" } },
				returnType: "void",
				execute() {
					run = true;
				},
			});

			const res = call("test:actions:params", { a: undefined as any });
			ok(!run && !res.success);
			ok(res.error instanceof RequiredArgumentMissingError);
		});

		it("should not trigger handler if required parameters are invalid", () => {
			let runC = 0;
			register({
				name: "test:actions:params",
				arguments: { a: { type: "number", validate: val => val > 0 } },
				returnType: "void",
				execute() {
					runC++;
				},
			});

			call("test:actions:params", { a: -1 });
			call("test:actions:params", { a: 3 });
			strictEqual(runC, 1);
		});

		it("should not trigger handler if optional parameters are invalid", () => {
			let runC = 0;
			register({
				name: "test:actions:optional",
				arguments: {
					a: {
						type: "number",
						optional: true,
						validate: val => val > 0,
					},
				},
				returnType: "void",
				execute() {
					runC++;
				},
			});

			call("test:actions:optional", { a: -1 });
			call("test:actions:optional", { a: 3 });
			strictEqual(runC, 1);
		});

		it("should handle invalid parameter types", () => {
			let runC = 0;
			register({
				name: "test:actions:params",
				arguments: { a: { type: "number", validate: val => val > 0 } },
				returnType: "void",
				execute() {
					runC++;
				},
			});

			// @ts-expect-error
			call("test:actions:params", { a: "123123" });
			call("test:actions:params", { a: 3 });
			strictEqual(runC, 1);
		});

		it("should catch throwing validators and not run action", () => {
			let runC = 0;
			register({
				name: "test:actions:params",
				arguments: {
					a: {
						type: "number",
						validate: () => {
							throw "oops";
						},
					},
				},
				returnType: "void",
				execute() {
					runC++;
				},
			});

			call("test:actions:params", { a: -1 });
			call("test:actions:params", { a: 3 });
			strictEqual(runC, 0);
		});

		it("should validate array and array items", () => {
			let runC = 0;
			register({
				name: "test:actions:array",
				arguments: {
					a: {
						type: "array",
						items: {
							type: "number",
							validate: n => n % 2 == 0 || "Must be even",
						},
						validate: arr => arr.length == 2 || "Wrong length",
					},
					b: {
						type: "array",
						optional: true,
						items: {
							type: "number",
							validate: n => n % 2 == 0 || "Must be even",
						},
						validate: arr => arr.length == 2 || "Wrong length",
					},
				},
				returnType: "void",
				execute() {
					runC++;
				},
			});

			call("test:actions:array", {
				a: [2, 4],
				b: [4, 6],
			});

			call("test:actions:array", {
				a: [2, 3],
			});

			call("test:actions:array", {
				a: [2, 4, 6],
			});

			call("test:actions:array", {
				a: [2, 4],
				b: [1, 2],
			});

			call("test:actions:array", {
				a: [2, 4],
				b: [2, 8, 4],
			});

			deepStrictEqual(runC, 1);
		});

		it("should validate object and object fields", () => {
			let runC = 0;
			register({
				name: "test:actions:object",
				arguments: {
					a: {
						type: "object",
						validate: ({ a, b }) => (a || 0) + b == 10,
						fields: {
							a: {
								type: "number",
								validate: n => n % 2 == 0,
								optional: true,
							},
							b: { type: "number", validate: n => n < 5 },
						},
					},
					b: {
						type: "object",
						optional: true,
						validate: ({ a, b }) => a + (b || 0) == 10,
						fields: {
							a: {
								type: "number",
								validate: n => n % 2 == 0,
							},
							b: {
								type: "number",
								optional: true,
								validate: n => n < 5,
							},
						},
					},
				},
				returnType: "void",
				execute() {
					runC++;
				},
			});

			// All valid
			call("test:actions:object", {
				a: { a: 8, b: 2 },
				b: { a: 6, b: 4 },
			});

			// a.a invalid
			call("test:actions:object", {
				a: { a: 7, b: 3 },
				b: { a: 6, b: 4 },
			});

			// a.b invalid
			call("test:actions:object", {
				a: { a: 4, b: 6 },
				b: { a: 6, b: 4 },
			});

			// a invalid
			call("test:actions:object", {
				a: { a: 2, b: 3 },
			});

			// b.a invalid
			call("test:actions:object", {
				a: { a: 8, b: 2 },
				b: { a: 7, b: 3 },
			});

			// b.b invalid
			call("test:actions:object", {
				a: { a: 8, b: 2 },
				b: { a: 4, b: 6 },
			});

			// b invalid
			call("test:actions:object", {
				a: { a: 8, b: 2 },
				b: { a: 2, b: 3 },
			});

			deepStrictEqual(runC, 1);
		});

		it("should validate nested objects and arrays", () => {
			let runC = 0;
			register({
				name: "test:actions:nested",
				arguments: {
					a: {
						type: "array",
						validate: a => a.length == 2,
						items: {
							type: "object",
							validate: ({ a, b }) => (a || 0) + b == 10,
							fields: {
								a: {
									type: "number",
									validate: n => n % 2 == 0,
									optional: true,
								},
								b: { type: "number", validate: n => n < 5 },
							},
						},
					},
				},
				returnType: "void",
				execute() {
					runC++;
				},
			});

			// Valid
			call("test:actions:nested", {
				a: [
					{ a: 8, b: 2 },
					{ a: 8, b: 2 },
				],
			});

			// a invalid
			call("test:actions:nested", {
				a: [{ a: 8, b: 2 }],
			});

			// a[0] invalid
			call("test:actions:nested", {
				a: [
					{ a: 4, b: 2 },
					{ a: 8, b: 2 },
				],
			});

			// a[1] invalid
			call("test:actions:nested", {
				a: [
					{ a: 8, b: 2 },
					{ a: 6, b: 2 },
				],
			});

			// a.a invalid
			call("test:actions:nested", {
				a: [
					{ a: 7, b: 3 },
					{ a: 8, b: 2 },
				],
			});

			// a.b invalid
			call("test:actions:nested", {
				a: [
					{ a: 8, b: 2 },
					{ a: 4, b: 6 },
				],
			});
		});

		// TODO: figure out if recursion prevention and stuff should be done
	});

	describe(".getActionInfo()", () => {
		it("should return action info", () => {
			register({
				name: "test:actions:params",
				displayName: "params",
				aliases: ["p"],
				description: "1",
				arguments: {
					a: {
						type: "number",
						description: "a",
						displayName: "A",
						aliases: ["a"],
					},
				},
				returnType: "void",
				execute() {},
			});

			const info = getActionInfo("test:actions:params");
			ok(info);
			deepStrictEqual(info, {
				name: "test:actions:params",
				displayName: "params",
				aliases: ["p"],
				description: "1",
				arguments: {
					a: {
						type: "number",
						description: "a",
						displayName: "A",
						aliases: ["a"],
					},
				},
				returnType: "void",
			});
		});

		it("should return null if action doesn't exist", () => {
			deepStrictEqual(getActionInfo("test:actions:dummy"), null);
		});
	});

	describe(".getActionNames()", () => {
		it("should return registed actions' names", () => {
			deepStrictEqual(getActionNames(), []);
			register({
				name: "test:actions:dummy",
				arguments: {},
				returnType: "void",
				execute() {},
			});
			deepStrictEqual(getActionNames(), ["test:actions:dummy"]);
			register({
				name: "test:actions:params",
				arguments: {
					a: {
						type: "number",
					},
				},
				returnType: "void",
				execute() {},
			});
			deepStrictEqual(getActionNames(), [
				"test:actions:dummy",
				"test:actions:params",
			]);
		});
	});

	describe(".getAllActionInfo()", () => {
		it("should return registed actions' info", () => {
			deepStrictEqual(getAllActionInfo(), []);
			register({
				name: "test:actions:dummy",
				arguments: {},
				returnType: "void",
				execute() {},
			});
			deepStrictEqual(getAllActionInfo(), [
				{
					name: "test:actions:dummy",
					arguments: {},
					returnType: "void",
				},
			]);
			register({
				name: "test:actions:params",
				arguments: {
					a: {
						type: "number",
					},
				},
				returnType: "void",
				execute() {},
			});
			deepStrictEqual(getAllActionInfo(), [
				{
					name: "test:actions:dummy",
					arguments: {},
					returnType: "void",
				},
				{
					name: "test:actions:params",
					arguments: {
						a: {
							type: "number",
						},
					},
					returnType: "void",
				},
			]);
		});
	});

	describe(".resolveAlias()", () => {
		beforeEach(() => {
			register({
				name: "test:actions:dummy",
				aliases: ["d"],
				displayName: "D",
				arguments: {},
				returnType: "void",
				execute() {},
			});
		});

		it("should resolve aliases", () => {
			deepStrictEqual("test:actions:dummy", resolveAlias("d"));
		});

		it("should resolve display names", () => {
			deepStrictEqual("test:actions:dummy", resolveAlias("D"));
		});

		it("should return action name if provided", () => {
			deepStrictEqual(
				"test:actions:dummy",
				resolveAlias("test:actions:dummy"),
			);
		});

		it("should return null if no action matches", () => {
			deepStrictEqual(null, resolveAlias("doesn't exist"));
		});
	});
});
