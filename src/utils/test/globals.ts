declare global {
	interface __test {
		active: true;
	}

	// eslint-disable-next-line no-var
	var __test: __test;
}

export function initTestGlobal() {
	if (!global.__test || typeof global.__test !== "object")
		global.__test = { active: true } as __test;
}
