import { readdir, readFile } from "fs/promises";
import type {
	ModuleInfo,
	ModuleInit,
	ModuleManifest,
	ModuleSystemDiagnostics,
} from "./types.ts";
import { join, resolve } from "path";
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
import { fileURLToPath, pathToFileURL } from "url";
import { existsSync } from "fs";

export const absoluteModulePath = resolve(
	fileURLToPath(new URL(".", import.meta.url)),
	"../../modules"
);

const modules = new Map<string, ModuleInfo>();
const initOrder = [] as string[];
let setupTime = 0;
let isSetupComplete = false;
let isSetupInProgress = false;

function setModuleInfo(name: string, update: Partial<ModuleInfo>) {
	modules.set(name, {
		...(modules.get(name) || {}),
		...update,
	} as ModuleInfo);
}

/**
 * Setup all modules in the `src/modules` directory.
 *
 * This method discovers modules, validates manifests, loads entry
 * points, and executes `init()` functions in alphabetical order. It should only
 * be called once during application startup. If called after modules have
 * already been setup, this function will return early and not do anything.
 *
 * Steps:
 * 1. Discovery - Read `src/modules` directory for subdirectories containing manifests
 * 2. Validation - Validate manifest structure and entry point existence
 * 3. Loading - Import init functions from each module
 * 4. Initialization - Execute all init functions sequentially
 *
 * This function does not throw. Module setup errors will be caught and
 * logged. A module which fails at any step will not be counted as a set up
 * module. Use {@link getReport} to access detailed module information.
 */
export async function setup(): Promise<void> {
	if (isSetupComplete || isSetupInProgress) return;

	isSetupInProgress = true;

	const startDate = Date.now();

	const moduleManifests = new Map<string, ModuleManifest>();

	for (const [name, manifest] of await discover()) {
		if (validate(name, manifest)) {
			moduleManifests.set(name, manifest);
		}
	}

	const moduleInits: Map<string, ModuleInit> = new Map();
	for (const [name, manifest] of moduleManifests) {
		const init = await load(manifest);
		if (init) moduleInits.set(name, init);
	}

	for (const [name, init] of moduleInits) {
		await initialize(name, init);
	}

	setupTime = Date.now() - startDate;

	isSetupInProgress = false;
	isSetupComplete = true;
}

/**
 * Discover all modules in the `src/modules` directory.
 *
 * @returns Map of all subdirectory names, and their manifest. A map is returned
 * instead of an array, because the validation step needs to know the
 * subdirectory name.
 */
async function discover(): Promise<Map<string, object>> {
	const directories = (
		await readdir(absoluteModulePath, { withFileTypes: true })
	)
		.filter(d => d.isDirectory())
		.map(d => d.name)
		.sort();

	const output = new Map<string, object>();

	for (const dir of directories) {
		try {
			const manifestRaw = await readFile(
				join(absoluteModulePath, dir, "manifest.json"),
				{ encoding: "utf8" }
			);
			const manifest = Object.freeze(JSON.parse(manifestRaw));

			if (typeof manifest !== "object" || Array.isArray(manifest))
				throw new Error("manifest JSON must be an object");

			output.set(dir, manifest);
		} catch (error) {
			setModuleInfo(dir, {
				name: dir,
				success: false,
				stage: "discovery",
				error: new ModuleDiscoveryError(dir, error),
			});
		}
	}

	for (const [name, manifest] of output)
		setModuleInfo(name, {
			name,
			success: true,
			stage: "discovery",
			manifest: manifest,
		});

	return output;
}

/**
 * Validates the provided manifest and checks for entry point existence.
 *
 * @param dirName - Module directory name
 * @param manifest - Module manifest
 *
 * @returns whether the manifest is valid or not
 */
function validate(
	dirName: string,
	manifest: object
): manifest is ModuleManifest {
	const { name, entry } = manifest as ModuleManifest;
	let error: ModuleValidationError | null = null;

	if (!name || typeof name !== "string")
		error = new ManifestMissingFieldError(dirName, "name");
	else if (!entry || typeof entry !== "string")
		error = new ManifestMissingFieldError(dirName, "entry");
	else if (name !== dirName)
		error = new ManifestNameMismatchError(dirName, name);
	else if (entry && !(entry.endsWith(".ts") || entry.endsWith(".js")))
		error = new ModuleValidationError(
			dirName,
			entry,
			"Entrypoint must be TypeScript or JavaScript"
		);
	// This is the only synchronous FS operation. The async alternatives
	// like `access()` are more complicated to use, especially inline like
	// this. Once the OS abstraction is done, the module system's FS
	// operations will be replaced anyway, so for now, this will do.
	else if (entry && !existsSync(join(absoluteModulePath, dirName, entry)))
		error = new ManifestEntryNotFoundError(dirName, entry);

	if (error) {
		setModuleInfo(dirName, {
			success: false,
			stage: "validation",
			error: error,
		});
		return false;
	}

	setModuleInfo(dirName, {
		success: true,
		stage: "validation",
	});
	return true;
}

/**
 * Imports the given module's entry point, and returns its `init()` function.
 *
 * @param manifest - module's manifest
 *
 * @returns the module's `init()` function, or `null` if a
 * {@link ModuleLoadError} occurred.
 */
async function load(manifest: ModuleManifest): Promise<ModuleInit | null> {
	const path = pathToFileURL(
		join(absoluteModulePath, manifest.name, manifest.entry)
	).href;

	let init;
	try {
		init = (await import(path)).init;
	} catch (error) {
		setModuleInfo(manifest.name, {
			success: false,
			stage: "loading",
			error: new ModuleLoadError(manifest.name, error),
		});
		return null;
	}

	if (!init || typeof init !== "function") {
		setModuleInfo(manifest.name, {
			success: false,
			stage: "loading",
			error: new EntryPointMissingInitError(manifest.name),
		});
		return null;
	}

	setModuleInfo(manifest.name, {
		success: true,
		stage: "loading",
	});

	return init;
}

/**
 * Runs the given module's `init()` function.
 *
 * @param name - module name
 * @param init - module init
 */
async function initialize(name: string, init: ModuleInit): Promise<void> {
	try {
		const startDate = Date.now();

		await init();
		const initTime = Date.now() - startDate;

		initOrder.push(name);

		setModuleInfo(name, {
			success: true,
			stage: "initialization",
			initTime,
		});
	} catch (error) {
		setModuleInfo(name, {
			success: false,
			stage: "initialization",
			error: new ModuleInitializationError(name, error),
		});
	}
}

/**
 * Get read-only copies of all successfully loaded module manifests.
 *
 * Returns an array of frozen manifest objects. Only modules that completed
 * initialization successfully are included in the results.
 *
 * @returns Array of read-only module manifests
 */
export function getManifests(): ReadonlyArray<Readonly<ModuleManifest>> {
	return Object.freeze(
		modules
			.values()
			.filter(m => m.success && m.stage === "initialization")
			.map(m => m.manifest)
			.toArray()
	);
}

/**
 * Get report about the module setup process
 */
export function getReport(): Readonly<ModuleSystemDiagnostics> {
	const moduleInfo = modules.values().toArray();

	return {
		discovered: moduleInfo.length,
		validated: moduleInfo.filter(
			m =>
				(m.stage === "validation" && m.success) ||
				m.stage === "loading" ||
				m.stage === "initialization"
		).length,
		loaded: moduleInfo.filter(
			m =>
				(m.stage === "loading" && m.success) ||
				m.stage === "initialization"
		).length,
		initialized: moduleInfo.filter(
			m => m.stage === "initialization" && m.success
		).length,
		failed: moduleInfo.filter(m => !m.success).length,

		setupTime,
		moduleDetails: modules.values().toArray(),
		errors: moduleInfo.filter(m => !m.success).map(m => m.error),
	};
}

/**
 * Get load order of modules
 */
export function getLoadOrder(): ReadonlyArray<string> {
	return Object.freeze([...initOrder]);
}

/**
 * Check if a specific module is set up successfully
 */
export function isModuleSetUp(moduleName: string): boolean {
	return modules.get(moduleName)?.success || false;
}

/**
 * Get information about a specific module
 */
export function getModuleInfo(moduleName: string): ModuleInfo | undefined {
	return modules.get(moduleName);
}

/**
 * Reset module system state. Should only be used in a testing environment.
 *
 * @throws if not run in a testing environment
 */
export function __resetState(): void {
	if (!__test?.active) throw new Error("Not in a testing environment!");

	modules.clear();
	initOrder.length = 0;
	setupTime = 0;
	isSetupComplete = false;
	isSetupInProgress = false;
}
