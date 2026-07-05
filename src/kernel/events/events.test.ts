import { describe, beforeEach, before, it } from "node:test";
import {
	__resetState,
	build,
	emit,
	getListener,
	listen,
	once,
	LISTENER_TIMEOUT,
	waitFor,
	on,
	getListeners,
	removeListener,
	off,
	removeAllListeners,
	getLast,
	RECURSION_LIMIT,
	getEventNames,
	getListenerMetrics,
	getEventMetrics,
	getMetrics,
} from "./events.ts";
import {
	strictEqual,
	ok,
	deepStrictEqual,
	notDeepStrictEqual,
	rejects,
} from "assert";
import {
	EventEmissionRecursionError,
	EventListenerError,
	EventListenerTimeoutError,
} from "./errors.ts";
import { initTestGlobal, nCr } from "#utils";

declare module "#kernel/events" {
	interface EventMap {
		"test:event-bus:dummy": null;
		"test:event-bus:payload": { a: number };
		"test:event-bus:wild:a": null;
		"test:event-bus:wild:b": null;
		"test:event-bus:wild:c:1": null;
	}
}

describe("Kernel.Events", () => {
	before(() => {
		initTestGlobal();
	});

	beforeEach(() => {
		__resetState();
	});

	describe(".listen()", () => {
		it("should return a subscription object with correct functionality", () => {
			const sub = listen("test:event-bus:dummy", () => {});
			ok(sub.id);
			strictEqual(sub.isActive(), true);
			sub.unsubscribe();
			strictEqual(sub.isActive(), false);
		});

		it("should invoke the handler on emission", async () => {
			let run = false;
			listen("test:event-bus:dummy", () => (run = true));
			await emit("test:event-bus:dummy");
			ok(run);
		});

		it("should listen to all matching events", async () => {
			let run = 0;
			listen("test:event-bus:wild:*", () => run++);
			await emit("test:event-bus:wild:a");
			await emit("test:event-bus:wild:b");
			await emit("test:event-bus:wild:c:1");

			strictEqual(run, 3);
		});

		it("should emit 'new-listener' event on new listener", async () => {
			let run = false;
			listen("event-bus:new-listener", () => (run = true));

			listen("test:event-bus:dummy", () => {});

			ok(run);
		});

		describe("options", () => {
			describe(".once", () => {
				it("should unsubscribe after first emission", async () => {
					let count = 0;
					const sub = listen("test:event-bus:dummy", () => count++, {
						once: true,
					});
					await emit("test:event-bus:dummy");
					await emit("test:event-bus:dummy");
					strictEqual(count, 1);
					strictEqual(sub.isActive(), false);
				});

				it("should unsubscribe immediately after sticky emission", async () => {
					let count = 0;
					await emit("test:event-bus:dummy");
					const sub = listen("test:event-bus:dummy", () => count++, {
						once: true,
						sticky: true,
					});
					strictEqual(sub.isActive(), false);
					strictEqual(count, 1);
					await emit("test:event-bus:dummy");
					strictEqual(sub.isActive(), false);
					strictEqual(count, 1);
				});
			});

			describe(".sticky", () => {
				it("should run listener instantly with previous payload", async () => {
					const payload = { a: 123 };
					await emit("test:event-bus:payload", payload);
					let received;
					listen(
						"test:event-bus:payload",
						e => (received = e.payload),
						{ sticky: true },
					);
					deepStrictEqual(received, payload);
				});

				// It might have been better design-wise if the sticky listener
				// was run with the last emission which passes the filter, however, that
				// requires storing all previous emissions, which takes up too much space.
				it("should ignore previous filtered events", async () => {
					const payload = { a: 123 };
					await emit("test:event-bus:payload", payload);
					let received;
					listen(
						"test:event-bus:payload",
						e => (received = e.payload),
						{ sticky: true, filter: () => false },
					);
					notDeepStrictEqual(received, payload);
				});

				it("should use the last emitted payload", async () => {
					const payload1 = { a: 1 };
					await emit("test:event-bus:payload", payload1);
					let res: any = null;
					listen("test:event-bus:payload", e => (res = e), {
						sticky: true,
					});
					ok(res);
					deepStrictEqual(res.payload, payload1);
				});

				it("should do nothing if no previous emission exists", () => {
					let res: any = null;
					listen("test:event-bus:payload", e => (res = e), {
						sticky: true,
					});
					ok(!res);
				});
			});

			describe(".priority", () => {
				it("should run higher-priority listeners first", async () => {
					const order = [] as number[];
					listen("test:event-bus:dummy", () => order.push(1), {
						priority: 1,
					});
					listen("test:event-bus:dummy", () => order.push(2), {
						priority: 5,
					});
					listen("test:event-bus:dummy", () => order.push(3), {
						priority: 10,
					});
					await emit("test:event-bus:dummy");
					deepStrictEqual(order, [3, 2, 1]);
				});

				it("should invoke the older listener if equal priority", async () => {
					const order = [] as number[];
					listen("test:event-bus:dummy", () => order.push(1), {
						priority: 5,
					});
					listen("test:event-bus:dummy", () => order.push(2), {
						priority: 5,
					});
					listen("test:event-bus:dummy", () => order.push(3), {
						priority: 5,
					});
					await emit("test:event-bus:dummy");
					deepStrictEqual(order, [1, 2, 3]);
				});
			});

			describe(".filter", () => {
				it("should ignore filtered emissions", async () => {
					let val;
					listen(
						"test:event-bus:payload",
						({ payload }) => (val = payload.a),
						{ filter: e => e.payload.a !== 1 },
					);
					await emit("test:event-bus:payload", { a: 5 });
					await emit("test:event-bus:payload", { a: 1 });
					strictEqual(val, 5);
				});
			});

			describe(".onError", () => {
				it("should be invoked on error", async () => {
					let run = false;
					let err: unknown;
					listen(
						"test:event-bus:dummy",
						() => {
							throw "oops";
						},
						{ onError: e => ((run = true), (err = e)) },
					);
					await emit("test:event-bus:dummy");
					strictEqual(run, true);
					ok(err instanceof EventListenerError);
					strictEqual(err.cause, "oops");
				});

				it("should be invoked on timeout error", async () => {
					let run = false;
					let err: unknown;
					listen(
						"test:event-bus:dummy",
						async () => {
							await new Promise(res =>
								setTimeout(res, LISTENER_TIMEOUT + 1000),
							);
						},
						{ onError: e => ((run = true), (err = e)) },
					);
					await emit("test:event-bus:dummy");
					strictEqual(run, true);
					ok(err instanceof EventListenerTimeoutError);
				});
			});
		});

		describe(".build()", () => {
			it("should correctly chain options", () => {
				const filterfn = () => false;
				const errfn = () => {};
				const handlerfn = () => {};
				const id = build("test:event-bus:payload")
					.once()
					.sticky()
					.priority(5)
					.filter(filterfn)
					.onError(errfn)
					.listen(handlerfn).id;
				const listener = getListener(id);
				ok(listener);
				strictEqual(listener.id, id);
				strictEqual(listener.handler, handlerfn);
				strictEqual(listener.key, "test:event-bus:payload");
				strictEqual(listener.options.once, true);
				strictEqual(listener.options.sticky, true);
				strictEqual(listener.options.priority, 5);
				strictEqual(listener.options.filter, filterfn);
				strictEqual(listener.options.onError, errfn);
			});
		});

		describe(".waitFor()", () => {
			it("should resolve with the emission when event fires", async () => {
				const promise = waitFor("test:event-bus:payload");
				await emit("test:event-bus:payload", { a: 42 });
				const emission = await promise;
				strictEqual(emission.payload.a, 42);
			});

			it("should reject after timeout", async () => {
				const promise = waitFor("test:event-bus:dummy", {
					timeout: 10,
				});
				await rejects(promise);
			});

			it("should respect filter option", async () => {
				const promise = waitFor("test:event-bus:payload", {
					filter: e => e.payload.a > 10,
				});
				await emit("test:event-bus:payload", { a: 5 }); // should not resolve
				await emit("test:event-bus:payload", { a: 15 });
				const emission = await promise;
				strictEqual(emission.payload.a, 15);
			});

			it("should respect sticky option", async () => {
				await emit("test:event-bus:payload", { a: 15 });
				const promise = waitFor("test:event-bus:payload", {
					sticky: true,
				});
				const emission = await promise;
				strictEqual(emission.payload.a, 15);
			});
		});

		describe(".once()", () => {
			it("should register a once listener", () => {
				const id = once("test:event-bus:dummy", () => {}).id;
				const listener = getListener(id);
				ok(listener);
				strictEqual(listener.options.once, true);
			});
		});

		describe(".on()", () => {
			it("should alias listen()", () => {
				strictEqual(on, listen);
			});
		});
	});

	describe(".getLast()", () => {
		it("should return the last emission", async () => {
			await emit("test:event-bus:payload", { a: 3 });

			const emission = getLast("test:event-bus:payload");

			ok(emission);
			deepStrictEqual(emission.payload, { a: 3 });
		});

		it("should return the last emission matching the wildcard", async () => {
			await emit("test:event-bus:wild:a");

			const emission = getLast("test:event-bus:wild:a");
			ok(emission);
		});

		it("should return null if no emission exists", async () => {
			const emission = getLast("test:event-bus:wild:a");
			strictEqual(emission, null);
		});
	});

	describe(".getListener()", () => {
		it("should return the listener with the given id", () => {
			const fn = () => {};
			const id = listen("test:event-bus:dummy", fn).id;
			const listener = getListener(id);
			ok(listener);
			strictEqual(listener.id, id);
			strictEqual(listener.handler, fn);
			strictEqual(listener.key, "test:event-bus:dummy");
		});
	});

	describe(".getListeners()", () => {
		it("should return the listeners of the given event", () => {
			const ids = new Set([
				listen("test:event-bus:dummy", () => {}).id,
				listen("test:event-bus:dummy", () => {}).id,
			]);
			deepStrictEqual(
				new Set(getListeners("test:event-bus:dummy").map(l => l.id)),
				ids,
			);
		});

		it("should return the listeners of the given wildcard", () => {
			const ids = new Set([
				listen("*", () => {}).id,
				listen("*", () => {}).id,
			]);
			deepStrictEqual(new Set(getListeners("*").map(l => l.id)), ids);
		});

		it("should return the listeners of all events included in the wildcard", () => {
			const ids = new Set([
				listen("test:event-bus:wild:a", () => {}).id,
				listen("test:event-bus:wild:b", () => {}).id,
			]);
			deepStrictEqual(
				new Set(
					getListeners("test:event-bus:wild:*", {
						resolveWildcard: true,
					}).map(l => l.id),
				),
				ids,
			);
		});

		it("should return the listeners of all wildcards which include the event", () => {
			const ids = new Set([
				listen("test:event-bus:wild:*", () => {}).id,
				listen("test:event-bus:wild:*", () => {}).id,
			]);
			deepStrictEqual(
				new Set(
					getListeners("test:event-bus:wild:a", {
						resolveWildcard: true,
					}).map(l => l.id),
				),
				ids,
			);
		});
	});

	describe(".removeListener()", () => {
		it("should remove the given listener by id", () => {
			const id = listen("test:event-bus:dummy", () => {}).id;
			removeListener(id);
			deepStrictEqual(getListeners("test:event-bus:dummy"), []);
		});

		it("should remove the given listener by key and handler", () => {
			const fn = () => {};
			listen("test:event-bus:dummy", fn).id;
			removeListener("test:event-bus:dummy", fn);
			deepStrictEqual(getListeners("test:event-bus:dummy"), []);
		});

		it("should emit 'remove-listener'", () => {
			let run = false;
			listen("event-bus:remove-listener", () => (run = true));

			removeListener(listen("test:event-bus:dummy", () => {}).id);
			ok(run);
		});

		describe(".off()", () => {
			it("should alias removeListener()", () => {
				strictEqual(off, removeListener);
			});
		});
	});

	describe(".removeAllListeners()", () => {
		it("should remove all listeners of the given event", () => {
			listen("test:event-bus:dummy", () => {});
			listen("test:event-bus:dummy", () => {});

			removeAllListeners("test:event-bus:dummy");

			deepStrictEqual(getListeners("test:event-bus:dummy"), []);
		});

		it("should remove all listeners of the given wildcard", () => {
			listen("*", () => {});
			listen("*", () => {});
			removeAllListeners("*");

			deepStrictEqual(getListeners("*"), []);
		});

		it("should remove all listeners of all events included in the wildcard", () => {
			listen("test:event-bus:wild:a", () => {});
			listen("test:event-bus:wild:b", () => {});
			removeAllListeners("test:event-bus:wild:*", {
				resolveWildcard: true,
			});

			deepStrictEqual(
				getListeners("test:event-bus:wild:*", {
					resolveWildcard: true,
				}),
				[],
			);
		});

		// Do we want this? Either this function works like getListeners, and
		// removes all wildcard listeners which resolve to the given event, or
		// we simply ignore the resolveWildcard flag, and remove listeners for
		// that event only.
		// The former would cause "*" listeners to be removed too, which may not
		// be what we want, and the latter would not guarantee that after
		// running removeAllListeners on a given event, its emission would cause
		// no listeners to be run, which seems like a reasonable invariant to
		// have
		it("resolveWildcard should have no effect if key isn't a wildcard", () => {
			const id = listen("test:event-bus:wild:*", () => {}).id;
			listen("test:event-bus:wild:a", () => {});
			listen("test:event-bus:wild:a", () => {});
			removeAllListeners("test:event-bus:wild:a", {
				resolveWildcard: true,
			});

			deepStrictEqual(
				getListeners("test:event-bus:wild:a", {
					resolveWildcard: true,
				}).map(l => l.id),
				[id],
			);
		});
	});

	describe(".emit()", () => {
		it("should invoke listeners", async () => {
			let run1 = false;
			let run2 = false;
			listen("test:event-bus:dummy", () => (run1 = true));
			listen("test:event-bus:dummy", () => (run2 = true));

			await emit("test:event-bus:dummy");
			ok(run1 && run2);
		});

		it("should pass payload", async () => {
			let payload = {} as unknown;
			listen("test:event-bus:payload", e => (payload = e.payload));

			await emit("test:event-bus:payload", { a: 3 });
			deepStrictEqual(payload, { a: 3 });
		});

		it("should await async listeners", async () => {
			let run1 = false;
			let run2 = false;
			listen("test:event-bus:dummy", async () => {
				await new Promise<void>(res =>
					setTimeout(() => {
						run1 = true;
						res();
					}, 1000),
				);
			});

			listen("test:event-bus:dummy", async () => {
				await new Promise<void>(res =>
					setTimeout(() => {
						run2 = true;
						res();
					}, 1000),
				);
			});

			await emit("test:event-bus:dummy");
			ok(run1 && run2);
		});

		it("shouldn't await meta listeners", async () => {
			let done = false;
			listen("event-bus:new-listener", async () => {
				await new Promise<void>(res =>
					setTimeout(() => {
						((done = true), res());
					}, 300),
				);
			});

			listen("test:event-bus:dummy", () => {});

			ok(!done);
			await new Promise<void>(res => setTimeout(res, 300));
			ok(done);
		});

		it("shouldn't invoke meta listeners on events regarding themselves", async () => {
			let run = 0;
			listen("event-bus:listener-error", () => {
				run++;
				throw "oops";
			});

			listen("test:event-bus:dummy", () => {
				throw "oops2";
			});

			await emit("test:event-bus:dummy");
			strictEqual(run, 1);
		});

		it("should invoke listeners in priority order", async () => {
			const order = [] as number[];
			listen("test:event-bus:dummy", () => order.push(2), {
				priority: 1,
			});
			listen("test:event-bus:dummy", () => order.push(1), {
				priority: 2,
			});

			await emit("test:event-bus:dummy");
			deepStrictEqual(order, [1, 2]);
		});

		it("should stop propagation", async () => {
			const order = [] as number[];
			listen("test:event-bus:dummy", e => {
				order.push(1);
				e.stopPropagation();
			});
			listen("test:event-bus:dummy", () => order.push(2));

			await emit("test:event-bus:dummy");
			deepStrictEqual(order, [1]);
		});

		it("should invoke matching wildcard listeners", async () => {
			let run = 0;
			listen("test:event-bus:wild:*", () => run++);

			await emit("test:event-bus:wild:a");
			await emit("test:event-bus:wild:b");

			deepStrictEqual(run, 2);
		});

		it("should emit 'listener-error' when a listener throws", async () => {
			let run = false;
			listen("event-bus:listener-error", () => (run = true));

			listen("test:event-bus:dummy", () => {
				throw "oops";
			});

			await emit("test:event-bus:dummy");

			ok(run);
		});

		describe("recursion prevention", () => {
			it("should allow each listener to recursively emit at most twice per recursive chain", async () => {
				let run = 0;
				listen("test:event-bus:dummy", async () => {
					run++;
					await emit("test:event-bus:dummy");
				});

				await emit("test:event-bus:dummy");
				strictEqual(run, RECURSION_LIMIT + 1);
			});

			it("should prevent direct recursive emissions with multiple listeners", async () => {
				let run = 0;
				listen("test:event-bus:dummy", async () => {
					run++;
					await emit("test:event-bus:dummy");
				});
				listen("test:event-bus:dummy", async () => {
					run++;
					await emit("test:event-bus:dummy");
				});

				await emit("test:event-bus:dummy");
				strictEqual(
					run,
					// With two listeners, the emission tree is binary.
					// Since each listener may recursively emit at most twice within a
					// single branch, the total number of listener executions equals the
					// number of reachable nodes in that tree.
					// This follows OEIS A134760 (- 1 to exclude the root emission).
					2 * nCr(2 * (RECURSION_LIMIT + 1), RECURSION_LIMIT + 1) - 2,
				);
			});

			it("should prevent indirect recursive emissions", async () => {
				let run = 0;
				listen("test:event-bus:wild:a", async () => {
					run++;
					await emit("test:event-bus:wild:b");
				});
				listen("test:event-bus:wild:b", async () => {
					run++;
					await emit("test:event-bus:wild:a");
				});

				await emit("test:event-bus:wild:a");
				strictEqual(run, RECURSION_LIMIT * 2 + 1);
			});

			it.todo(
				// TODO: This currently breaks the event bus. It's similar to the
				// test above, except it continuously registers new listeners.
				"should prevent infinite loops with nested listener registration",
				{ skip: true },
				() => {
					listen("test:event-bus:dummy", () => {
						listen("test:event-bus:dummy", () => {
							emit("test:event-bus:dummy");
						});
						emit("test:event-bus:dummy");
					});
					emit("test:event-bus:dummy");
				},
			);

			it("should allow non-looping recursion", async () => {
				let run = 0;
				listen("test:event-bus:dummy", async () => {
					run++;
					await emit("test:event-bus:wild:a");
				});
				listen("test:event-bus:wild:a", async () => {
					run++;
					await emit("test:event-bus:wild:b");
				});
				listen("test:event-bus:wild:b", async () => {
					run++;
					await emit("test:event-bus:wild:c:1");
				});
				listen("test:event-bus:wild:c:1", async () => {
					run++;
				});

				await emit("test:event-bus:dummy");
				strictEqual(run, 4);
			});

			it("should emit 'listener-error' when recursion is prevented", async () => {
				let err: unknown;
				listen("event-bus:listener-error", e => {
					err = e.payload;
				});
				listen("test:event-bus:dummy", async () => {
					await emit("test:event-bus:dummy");
				});

				await emit("test:event-bus:dummy");
				ok(err && err instanceof EventEmissionRecursionError);
			});

			// We don't test recursion prevention with dynamically changing
			// event names (e.g. a "test:*" listener emitting "test:1" then
			// "test:1:2", "test:1:2:3", etc...). Since every event
			// needs to be statically defined in the EventMap beforehand,
			// we're guaranteed to have a finite amount of events.
			// Of course, nothing is enforcing this at runtime, but if you're
			// purposefully ignoring type errors like this, you're just asking
			// for trouble.
		});
	});

	describe(".getEventNames()", () => {
		it("should return all known event names", async () => {
			deepStrictEqual(getEventNames(), []);
			await emit("test:event-bus:dummy");
			deepStrictEqual(getEventNames(), ["test:event-bus:dummy"]);
			await emit("test:event-bus:wild:a");
			await emit("test:event-bus:wild:b");
			deepStrictEqual(getEventNames(), [
				"test:event-bus:dummy",
				"test:event-bus:wild:a",
				"test:event-bus:wild:b",
			]);
		});
	});

	describe(".getMetrics()", () => {
		it("should return metrics", async () => {
			const id = listen("test:event-bus:dummy", () => {}).id;
			await emit("test:event-bus:dummy");
			const metrics = getMetrics();
			ok(metrics);
			strictEqual(metrics.emissionCount, 2); // +1 for new-listener
			strictEqual(metrics.listenerCount, 1);
			deepStrictEqual(metrics.errors, []);
			deepStrictEqual(Object.keys(metrics.listeners), [id]);
			deepStrictEqual(Object.keys(metrics.events), [
				"test:event-bus:dummy",
				"event-bus:new-listener",
			]);
		});

		it("should stay consistent with getEventNames and getListeners", async () => {
			listen("test:event-bus:dummy", () => {}).id;
			listen("test:event-bus:wild:b", () => {}).id;
			await emit("test:event-bus:dummy");
			await emit("test:event-bus:wild:a");
			const metrics = getMetrics();
			ok(metrics);
			deepStrictEqual(
				Object.keys(metrics.listeners),
				getListeners("*", { resolveWildcard: true }).map(l => l.id),
			);
			deepStrictEqual(Object.keys(metrics.events), getEventNames());
		});
	});

	describe(".getEventMetrics()", () => {
		it("should return metrics for an event", async () => {
			const id = listen("test:event-bus:dummy", () => {}).id;
			await emit("test:event-bus:dummy");
			const metrics = getEventMetrics("test:event-bus:dummy");
			ok(metrics);
			strictEqual(metrics.name, "test:event-bus:dummy");
			strictEqual(metrics.emissionCount, 1);
			strictEqual(metrics.listenerCount, 1);
			deepStrictEqual(metrics.listeners, [getListener(id)]);
		});
	});

	describe(".getListenerMetrics()", () => {
		it("should return metrics by id", async () => {
			const id = listen("test:event-bus:dummy", () => {}, {
				priority: 3,
			}).id;
			await emit("test:event-bus:dummy");
			const metrics = getListenerMetrics(id);
			ok(metrics);
			strictEqual(metrics.id, id);
			strictEqual(metrics.key, "test:event-bus:dummy");
			strictEqual(metrics.runCount, 1);
			strictEqual(metrics.options.priority, 3);
			deepStrictEqual(metrics.errors, []);
		});

		it("should return metrics by listener", async () => {
			const id = listen("test:event-bus:dummy", () => {}, {}).id;
			const metrics = getListenerMetrics(getListener(id)!);
			ok(metrics);
		});

		it("should return null if the listener does not exist", () => {
			strictEqual(getListenerMetrics("1234"), null);
		});
	});
});
