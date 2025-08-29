import {
	backupDir,
	createManifest,
	createModule,
	createNormalManifest,
	createNormalModules,
	initTestGlobal,
	restoreDir,
} from "#test-utils";
import {
	deepStrictEqual,
	ok,
	partialDeepStrictEqual,
	strictEqual,
} from "assert";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import {
	__resetState,
	absoluteModulePath,
	getLoadOrder,
	getModuleInfo,
	getReport,
	getManifests,
	setup,
} from "./modules.ts";
import { mkdirSync, rmSync } from "fs";
import {
	EntryPointMissingInitError,
	ManifestEntryNotFoundError,
	ManifestMissingFieldError,
	ManifestNameMismatchError,
	ModuleDiscoveryError,
	ModuleInitializationError,
	ModuleLoadError,
	ModuleValidationError,
} from "./errors.ts";

describe("Kernel.Modules", () => {
	before(() => {
		initTestGlobal();

		backupDir(absoluteModulePath);
	});

	after(() => {
		restoreDir(absoluteModulePath);
	});

	beforeEach(() => {
		__resetState();
		__test.modules = [];

		mkdirSync(absoluteModulePath);
	});

	afterEach(() => {
		rmSync(absoluteModulePath, { recursive: true });
	});

	describe(".setup()", () => {
		it("should initialize all modules", async () => {
			createNormalModules(50);

			await setup();

			strictEqual(getManifests().length, 50);
			strictEqual(__test.modules.length, 50);
		});

		it("should handle empty module directory", async () => {
			await setup();

			strictEqual(getManifests().length, 0);
			strictEqual(__test.modules.length, 0);
		});

		it("should handle mixed valid and invalid modules", async () => {
			createNormalModules(5);

			createModule("invalid-1", { name: "" });
			createModule("invalid-2", undefined);
			createModule("invalid-3", {
				name: "invalid-3",
				entry: "../bad.ts",
			});

			createModule(
				"throws-error",
				{
					name: "throws-error",
					description: "Test",
					displayName: "Test",
					entry: "index.ts",
				},
				"throw 'i threw'"
			);

			await setup();

			strictEqual(__test.modules.length, 5);
			strictEqual(getManifests().length, 5);
		});

		it("should handle TypeScript and JavaScript modules", async () => {
			createNormalModules(1);
			createModule(
				"js-module",
				{
					name: "js-module",
					description: "Test",
					displayName: "Test",
					entry: "index.js",
				},
				"global.__test.modules.push('js-module')"
			);

			await setup();

			strictEqual(__test.modules.length, 2);
			strictEqual(getManifests().length, 2);
		});

		it("should fail at discovery stage", async () => {
			createModule("no-manifest", undefined);
			createModule("invalid-json", undefined);
			createManifest("invalid-json", '{"badJSON": // bla bla }}');
			createModule("json-not-object", undefined);
			createManifest("json-not-object", "[123]");

			await setup();

			strictEqual(getManifests().length, 0);

			const noManifest = getModuleInfo("no-manifest");
			const invalidJson = getModuleInfo("invalid-json");
			const jsonNotObject = getModuleInfo("json-not-object");

			ok(
				noManifest &&
					!noManifest.success &&
					noManifest.error instanceof ModuleDiscoveryError
			);

			ok(
				invalidJson &&
					!invalidJson.success &&
					invalidJson.error instanceof ModuleDiscoveryError
			);

			ok(
				jsonNotObject &&
					!jsonNotObject.success &&
					jsonNotObject.error instanceof ModuleDiscoveryError
			);
		});

		it("should fail at validation stage", async () => {
			createModule("missing-field", { name: "missing-field" });
			createModule("name-mismatch", {
				name: "different-name",
				entry: "index.ts",
			});
			createModule("non-existing-entry", {
				name: "non-existing-entry",
				entry: "index.ts",
			});
			createModule("wrong-field-type", undefined);
			createManifest(
				"wrong-field-type",
				'{"name": 123, "entry": ["bla bla"]}'
			);

			await setup();

			strictEqual(getManifests().length, 0);

			const missingField = getModuleInfo("missing-field");
			const nameMismatch = getModuleInfo("name-mismatch");
			const nonExistingEntry = getModuleInfo("non-existing-entry");
			const wrongFieldType = getModuleInfo("wrong-field-type");

			ok(
				missingField &&
					!missingField.success &&
					missingField.error instanceof ManifestMissingFieldError
			);

			ok(
				nameMismatch &&
					!nameMismatch.success &&
					nameMismatch.error instanceof ManifestNameMismatchError
			);

			ok(
				nonExistingEntry &&
					!nonExistingEntry.success &&
					nonExistingEntry.error instanceof ManifestEntryNotFoundError
			);

			ok(
				wrongFieldType &&
					!wrongFieldType.success &&
					wrongFieldType.error instanceof ManifestMissingFieldError
			);
		});

		it("should fail at loading stage", async () => {
			createModule(
				"no-init-export",
				{ name: "no-init-export", entry: "index.ts" },
				"export function notInit() {}",
				{ exactCode: true }
			);

			createModule(
				"init-not-a-function",
				{ name: "init-not-a-function", entry: "index.ts" },
				"export const init = 123",
				{ exactCode: true }
			);

			createModule(
				"throws-on-import",
				{ name: "throws-on-import", entry: "index.ts" },
				"throw new Error();",
				{ exactCode: true }
			);

			await setup();

			strictEqual(getManifests().length, 0);

			const noInitExport = getModuleInfo("no-init-export");
			const throwsOnImport = getModuleInfo("throws-on-import");
			const initNotAFunction = getModuleInfo("init-not-a-function");

			ok(
				noInitExport &&
					!noInitExport.success &&
					noInitExport.error instanceof EntryPointMissingInitError
			);

			ok(
				throwsOnImport &&
					!throwsOnImport.success &&
					throwsOnImport.error instanceof ModuleLoadError
			);

			ok(
				initNotAFunction &&
					!initNotAFunction.success &&
					initNotAFunction.error instanceof EntryPointMissingInitError
			);
		});

		it("should fail at initialization stage", async () => {
			createModule(
				"init-throws",
				{ name: "init-throws", entry: "index.ts" },
				"throw new Error();"
			);

			await setup();

			strictEqual(getManifests().length, 0);

			const initThrows = getModuleInfo("init-throws");

			ok(
				initThrows &&
					!initThrows.success &&
					initThrows.error instanceof ModuleInitializationError
			);
		});

		it("should handle repeated setup calls", async () => {
			createNormalModules(3);

			await setup();
			const firstCall = getManifests().length;

			await setup();
			const secondCall = getManifests().length;

			strictEqual(firstCall, 3);
			strictEqual(secondCall, 3);
			strictEqual(__test.modules.length, 3);
		});
	});
	describe(".getReport()", () => {
		it("should generate correct report for all-successful modules", async () => {
			createNormalModules(10);

			await setup();

			const report = getReport();

			strictEqual(report.discovered, 10);
			strictEqual(report.validated, 10);
			strictEqual(report.loaded, 10);
			strictEqual(report.initialized, 10);
			strictEqual(report.failed, 0);
			strictEqual(report.errors.length, 0);
			// Use partial because we can't guess init time in advance

			for (let i = 0; i < report.moduleDetails.length; i++) {
				partialDeepStrictEqual(report.moduleDetails[i], {
					name: "test-module-" + i,
					manifest: createNormalManifest(i),
					success: true,
					stage: "initialization",
				});
			}
		});

		it("should generate correct report for a mix of successful and unsuccessful modules", async () => {
			createNormalModules(10);

			// Fails at discovery
			createModule("no-manifest", undefined);

			// Fails at validation
			createModule("missing-field", { name: "missing-field" });

			// Fails at loading
			createModule(
				"no-init-export",
				{ name: "no-init-export", entry: "index.ts" },
				"export function notInit() {}",
				{ exactCode: true }
			);

			// Fails at init
			createModule(
				"init-throws",
				{ name: "init-throws", entry: "index.ts" },
				"throw new Error();"
			);

			await setup();

			const report = getReport();

			strictEqual(report.discovered, 14);
			strictEqual(report.validated, 12);
			strictEqual(report.loaded, 11);
			strictEqual(report.initialized, 10);
			strictEqual(report.failed, 4);
			strictEqual(report.errors.length, 4);

			const errors = report.errors;
			ok(
				errors.find(err => err instanceof ModuleDiscoveryError) &&
					errors.find(err => err instanceof ModuleValidationError) &&
					errors.find(err => err instanceof ModuleLoadError) &&
					errors.find(err => err instanceof ModuleInitializationError)
			);
		});

		it("should give correct setup time", async () => {
			createNormalModules(10);

			const start = Date.now();
			await setup();
			const duration = Date.now() - start;

			const report = getReport();

			strictEqual(duration, report.setupTime);
		});

		it("should give correct module init time", async () => {
			createModule(
				"long-init",
				{
					name: "long-init",
					entry: "index.ts",
				},
				"await new Promise(resolve => setTimeout(resolve, 3000));" +
					"global.__test.modules.push('long-init');"
			);

			await setup();

			const longInit = getModuleInfo("long-init");

			ok(
				longInit &&
					longInit.success &&
					longInit.stage === "initialization"
			);

			ok(longInit.initTime > 2900);

			strictEqual(getManifests().length, 1);
			strictEqual(__test.modules.length, 1);
		});
	});
	describe(".getLoadOrder()", () => {
		it("should list modules in alphabetical order", async () => {
			createNormalModules(10);

			await setup();

			deepStrictEqual(getLoadOrder(), __test.modules);
		});
		it("should list successful modules in alphabetical order", async () => {
			createNormalModules(10);

			// Invalid modules that are set up in between the normal modules
			createModule("test-module-1.5", {
				name: "different-name",
			});
			createModule(
				"test-module-3.5",
				{
					name: "test-module-3.5",
					entry: "index.ts",
				},
				"throw new Error()"
			);
			createModule("test-module-5.5", {
				name: "test-module-5.5",
			});
			createModule("test-module-7.5", {
				name: "test-module-7.5",
				entry: "index.ts",
			});

			await setup();

			deepStrictEqual(getLoadOrder(), __test.modules);
		});
	});
});
