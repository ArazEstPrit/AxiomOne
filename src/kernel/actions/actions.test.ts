import { describe, it } from "node:test";

describe("Kernel.Actions", () => {
	describe(".register()", () => {
		it("should register action");

		// Do we want this? Ignoring re-registers could be limiting (how?), and
		// overriding would allow stuff like a module wrapping another module's
		// action by overriding it, but shouldn't that be an explicit part of
		// the API, instead of a side effect? Having a dedicated wrap function
		// would provide better traceability, or maybe said traceability should
		// be done by this function (i.e. the subsystem remembers overridden
		// actions)
		it("should override action on re-register");
	});

	describe(".call()", () => {
		it("should trigger action handler");

		it("should handle throwing handler");

		it("should return action result");

		it("should pass parameters to action handler");

		it("should throw if action doesn't exist");

		it("should resolve aliases");

		it("should validate parameters");

		it("should handle throwing validators");

		it("should not trigger handler if required parameters aren't provided");

		it("should not trigger handler if required parameters are invalid");
	});

	describe(".getAction()", () => {
		it("should return registed action");

		it("should resolve aliases");

		it("should return null if action doesn't exist");
	});

	describe(".getActionNames()", () => {
		it("should return registed actions' names");
	});
});
