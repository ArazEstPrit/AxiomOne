import type {
	ModuleInfo,
	ModuleInit,
	ModuleManifest,
	ModuleRegistrationInfo,
} from "./types.ts";
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
import { APP_PATH, dir, exists, join } from "#kernel/fs";
import { begin, currentScopeOf, run, setKindAttribute } from "#kernel/scope";

declare module "#kernel/scope" {
	export interface ScopeKindMap {
		"module-registration": {
			modules: Record<string, ModuleInfo>;
			initOrder: string[];
		};
		module: { name: string };
	}
}

export const MODULES_PATH = join(APP_PATH, "src/modules");

function setModuleInfo(name: string, update: Partial<ModuleInfo>) {
	const modules = currentScopeOf("module-registration")!.attributes.modules;
	setKindAttribute("module-registration", "modules", {
		...modules,
		[name]: {
			...(modules[name] || {}),
			...update,
		} as ModuleInfo,
	});
}

/**
 * Set up all modules in the `src/modules` directory.
 *
 * This method discovers modules, validates manifests, loads entry
 * points, and executes `init()` functions in alphabetical order. It should only
 * be called once during application startup.
 *
 * Steps:
 * 1. Discovery - Read `src/modules` directory for subdirectories containing manifests
 * 2. Validation - Validate manifest structure and entry point existence
 * 3. Loading - Import init functions from each module
 * 4. Initialization - Execute all init functions sequentially
 *
 * This function does not throw. Module setup errors are caught and
 * logged. A module which fails at any step will not be counted as a set up
 * module.
 *
 * @returns module registration info
 */
export async function setup(): Promise<ModuleRegistrationInfo> {
	if (currentScopeOf("module-registration")) return null as never;

	using scope = begin("module-registration", "Module Registration", {
		modules: {},
		initOrder: [],
	});

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

	const r = report();
	scope.end();
	return r;
}

/**
 * Discover all modules in the `src/modules` directory.
 *
 * @returns Map of all subdirectory names, and their manifest. A map is returned
 * instead of an array, because the validation step needs to know the
 * subdirectory name.
 */
async function discover(): Promise<Map<string, object>> {
	const directories = await dir(MODULES_PATH).dirs();
	const output = new Map<string, object>();

	for (const dir of directories) {
		try {
			const manifest = Object.freeze(
				await dir.file("manifest.json").json(),
			);

			if (typeof manifest !== "object" || Array.isArray(manifest))
				throw new Error("manifest JSON must be an object");

			output.set(dir.name, manifest);
		} catch (error) {
			setModuleInfo(dir.name, {
				name: dir.name,
				success: false,
				stage: "discovery",
				error: new ModuleDiscoveryError(dir.name, error),
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
 * Validates the provided manifest.
 *
 * @param dirName - Module directory name
 * @param manifest - Module manifest
 *
 * @returns whether the manifest is valid or not
 */
function validate(
	dirName: string,
	manifest: object,
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
			"Entrypoint must be TypeScript or JavaScript",
		);

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
	const path = join(MODULES_PATH, manifest.name, manifest.entry);

	if (!(await exists(path))) {
		setModuleInfo(manifest.name, {
			success: false,
			stage: "loading",
			error: new EntryPointNotFoundError(manifest.name, manifest.entry),
		});
		return null;
	}

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
		await run("module", `Module "${name}"`, init, { name });

		currentScopeOf("module-registration")!.attributes.initOrder.push(name);

		setModuleInfo(name, {
			success: true,
			stage: "initialization",
		});
	} catch (error) {
		setModuleInfo(name, {
			success: false,
			stage: "initialization",
			error: new ModuleInitializationError(name, error),
		});
	}
}

function report(): Readonly<ModuleRegistrationInfo> {
	const { modules, initOrder } = currentScopeOf(
		"module-registration",
	)!.attributes;
	const moduleDetails = Object.values(modules);

	return {
		discovered: moduleDetails.length,
		validated: moduleDetails.filter(
			m =>
				(m.stage === "validation" && m.success) ||
				m.stage === "loading" ||
				m.stage === "initialization",
		).length,
		loaded: moduleDetails.filter(
			m =>
				(m.stage === "loading" && m.success) ||
				m.stage === "initialization",
		).length,
		initialized: moduleDetails.filter(
			m => m.stage === "initialization" && m.success,
		).length,
		failed: moduleDetails.filter(m => !m.success).length,

		manifests: moduleDetails
			.filter(m => m.success && m.stage === "initialization")
			.map(m => m.manifest),
		moduleInfo: modules,
		initOrder,
		errors: moduleDetails.filter(m => !m.success).map(m => m.error),
	};
}
