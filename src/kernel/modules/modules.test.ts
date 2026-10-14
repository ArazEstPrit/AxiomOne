import {
	backupDir,
	createManifest,
	createModule,
	createNormalManifest,
	createNormalModules,
	initTestGlobal,
	restoreDir,
} from "#utils";
import { ok, partialDeepStrictEqual, strictEqual } from "assert";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import { MODULES_PATH, setup } from "./modules.ts";
import { mkdirSync, rmSync } from "fs";
import {
	EntryPointMissingInitError,
	EntryPointNotFoundError,
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

		backupDir(MODULES_PATH);
	});

	after(() => {
		restoreDir(MODULES_PATH);
	});

	beforeEach(() => {
		__test.modules = [];

		mkdirSync(MODULES_PATH);
	});

	afterEach(() => {
		rmSync(MODULES_PATH, { recursive: true });
	});

	describe(".setup()", () => {
		it("should initialize all modules", async () => {
			createNormalModules(50);

			const { manifests } = await setup();

			strictEqual(manifests.length, 50);
			strictEqual(__test.modules.length, 50);
		});

		it("should handle empty module directory", async () => {
			const { manifests } = await setup();

			strictEqual(manifests.length, 0);
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
				"throw 'i threw'",
			);

			const { manifests } = await setup();

			strictEqual(__test.modules.length, 5);
			strictEqual(manifests.length, 5);
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
				"global.__test.modules.push('js-module')",
			);

			const { manifests } = await setup();

			strictEqual(__test.modules.length, 2);
			strictEqual(manifests.length, 2);
		});

		it("should fail at discovery stage", async () => {
			createModule("no-manifest", undefined);
			createModule("invalid-json", undefined);
			createManifest("invalid-json", '{"badJSON": // bla bla }}');
			createModule("json-not-object", undefined);
			createManifest("json-not-object", "[123]");

			const { manifests, moduleInfo } = await setup();

			strictEqual(manifests.length, 0);

			const noManifest = moduleInfo["no-manifest"];
			const invalidJson = moduleInfo["invalid-json"];
			const jsonNotObject = moduleInfo["json-not-object"];

			ok(
				noManifest &&
					!noManifest.success &&
					noManifest.error instanceof ModuleDiscoveryError,
			);

			ok(
				invalidJson &&
					!invalidJson.success &&
					invalidJson.error instanceof ModuleDiscoveryError,
			);

			ok(
				jsonNotObject &&
					!jsonNotObject.success &&
					jsonNotObject.error instanceof ModuleDiscoveryError,
			);
		});

		it("should fail at validation stage", async () => {
			createModule("missing-field", { name: "missing-field" });
			createModule("name-mismatch", {
				name: "different-name",
				entry: "index.ts",
			});
			createModule("wrong-field-type", undefined);
			createManifest(
				"wrong-field-type",
				'{"name": 123, "entry": ["bla bla"]}',
			);

			const { manifests, moduleInfo } = await setup();

			strictEqual(manifests.length, 0);

			const missingField = moduleInfo["missing-field"];
			const nameMismatch = moduleInfo["name-mismatch"];
			const wrongFieldType = moduleInfo["wrong-field-type"];

			ok(
				missingField &&
					!missingField.success &&
					missingField.error instanceof ManifestMissingFieldError,
			);

			ok(
				nameMismatch &&
					!nameMismatch.success &&
					nameMismatch.error instanceof ManifestNameMismatchError,
			);

			ok(
				wrongFieldType &&
					!wrongFieldType.success &&
					wrongFieldType.error instanceof ManifestMissingFieldError,
			);
		});

		it("should fail at loading stage", async () => {
			createModule("non-existing-entry", {
				name: "non-existing-entry",
				entry: "index.ts",
			});

			createModule(
				"no-init-export",
				{ name: "no-init-export", entry: "index.ts" },
				"export function notInit() {}",
				{ exactCode: true },
			);

			createModule(
				"init-not-a-function",
				{ name: "init-not-a-function", entry: "index.ts" },
				"export const init = 123",
				{ exactCode: true },
			);

			createModule(
				"throws-on-import",
				{ name: "throws-on-import", entry: "index.ts" },
				"throw new Error();",
				{ exactCode: true },
			);

			const { manifests, moduleInfo } = await setup();

			strictEqual(manifests.length, 0);

			const nonExistingEntry = moduleInfo["non-existing-entry"];
			const noInitExport = moduleInfo["no-init-export"];
			const throwsOnImport = moduleInfo["throws-on-import"];
			const initNotAFunction = moduleInfo["init-not-a-function"];

			ok(
				nonExistingEntry &&
					!nonExistingEntry.success &&
					nonExistingEntry.error instanceof EntryPointNotFoundError,
			);

			ok(
				noInitExport &&
					!noInitExport.success &&
					noInitExport.error instanceof EntryPointMissingInitError,
			);

			ok(
				throwsOnImport &&
					!throwsOnImport.success &&
					throwsOnImport.error instanceof ModuleLoadError,
			);

			ok(
				initNotAFunction &&
					!initNotAFunction.success &&
					initNotAFunction.error instanceof
						EntryPointMissingInitError,
			);
		});

		it("should fail at initialization stage", async () => {
			createModule(
				"init-throws",
				{ name: "init-throws", entry: "index.ts" },
				"throw new Error();",
			);

			const { manifests, moduleInfo } = await setup();

			strictEqual(manifests.length, 0);

			const initThrows = moduleInfo["init-throws"];

			ok(
				initThrows &&
					!initThrows.success &&
					initThrows.error instanceof ModuleInitializationError,
			);
		});

		describe("report", () => {
			it("should return correct report for all-successful modules", async () => {
				createNormalModules(10);

				const report = await setup();

				strictEqual(report.discovered, 10);
				strictEqual(report.validated, 10);
				strictEqual(report.loaded, 10);
				strictEqual(report.initialized, 10);
				strictEqual(report.failed, 0);
				strictEqual(report.errors.length, 0);

				// Use partial because we can't guess init time in advance
				for (const name in report.moduleInfo) {
					partialDeepStrictEqual(report.moduleInfo[name], {
						name,
						manifest: createNormalManifest(
							parseInt(name.split("-").at(-1)!),
						),
						success: true,
						stage: "initialization",
					});
				}
			});

			it("should return correct report for a mix of successful and unsuccessful modules", async () => {
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
					{ exactCode: true },
				);

				// Fails at init
				createModule(
					"init-throws",
					{ name: "init-throws", entry: "index.ts" },
					"throw new Error();",
				);

				const report = await setup();

				strictEqual(report.discovered, 14);
				strictEqual(report.validated, 12);
				strictEqual(report.loaded, 11);
				strictEqual(report.initialized, 10);
				strictEqual(report.failed, 4);
				strictEqual(report.errors.length, 4);

				const errors = report.errors;
				ok(
					errors.find(err => err instanceof ModuleDiscoveryError) &&
						errors.find(
							err => err instanceof ModuleValidationError,
						) &&
						errors.find(err => err instanceof ModuleLoadError) &&
						errors.find(
							err => err instanceof ModuleInitializationError,
						),
				);
			});
		});
	});
});
