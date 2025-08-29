import { ModuleSetupError } from "./errors.ts";

/**
 * Module manifest structure defining module metadata.
 *
 * The manifest.json file must be valid JSON and contain at minimum
 * the `name` and `entry` fields. Additional fields are preserved but not
 * validated.
 */
export interface ModuleManifest {
	/**
	 * Module name. Must match the containing folder name exactly.
	 * Should be kebab-case without spaces.
	 */
	name: string;

	/**
	 * Human-readable display name shown in UI.
	 * Can contain spaces and special characters.
	 */
	displayName?: string;

	/**
	 * Description of the module's functionality.
	 */
	description?: string;

	/**
	 * Relative path to the TypeScript/JavaScript entry point file.
	 * Must end with `.ts` or `.js`.
	 * The entry point must export a function named `init()`.
	 */
	entry: string;
}

/**
 * Function signature for module initialization.
 *
 * The `init` function is called once during application startup after all modules
 * have been loaded and validated. It should perform any setup required for the
 * module to function properly during the application's runtime.
 *
 * Can be synchronous or asynchronous.
 */
export type ModuleInit = () => void | Promise<void>;

/**
 * Statistics about module setup.
 */
export interface ModuleSystemDiagnostics {
	/** Number of module directories found */
	discovered: number;

	/** Number of modules that passed validation */
	validated: number;

	/** Number of successfully loaded modules */
	loaded: number;

	/** Number of successfully initialized modules */
	initialized: number;

	/** Number of modules that failed during any stage */
	failed: number;

	/** Total time taken for the entire setup process (ms) */
	setupTime: number;

	/** List of errors that occurred during the setup process */
	errors: ModuleSetupError[];

	/** Individual module info */
	moduleDetails: ModuleInfo[];
}

export type ModuleSetupStage =
	| "discovery"
	| "validation"
	| "loading"
	| "initialization";

export type ModuleInfo =
	| DiscoveryFailedModuleInfo
	| DiscoveredModuleInfo
	| ValidationFailedModuleInfo
	| ValidatedModuleInfo
	| LoadFailedModuleInfo
	| LoadedModuleInfo
	| InitializationFailedModuleInfo
	| InitializedModuleInfo;

interface BaseModuleInfo {
	/** Module name */
	name: string;
	/** Stage the module is currently at */
	stage: ModuleSetupStage;
	/** Success status */
	success: boolean;
}

export interface DiscoveryFailedModuleInfo extends BaseModuleInfo {
	stage: "discovery";
	success: false;
	error: ModuleSetupError;
}

export interface DiscoveredModuleInfo extends BaseModuleInfo {
	stage: "discovery";
	success: true;
	manifest: object;
}

export interface ValidationFailedModuleInfo extends BaseModuleInfo {
	stage: "validation";
	success: false;
	error: ModuleSetupError;
	manifest: object;
}

export interface ValidatedModuleInfo extends BaseModuleInfo {
	stage: "validation";
	success: true;
	manifest: Readonly<ModuleManifest>;
}

export interface LoadFailedModuleInfo extends BaseModuleInfo {
	stage: "loading";
	success: false;
	error: ModuleSetupError;
	manifest: Readonly<ModuleManifest>;
}

export interface LoadedModuleInfo extends BaseModuleInfo {
	stage: "loading";
	success: true;
	manifest: Readonly<ModuleManifest>;
}

export interface InitializationFailedModuleInfo extends BaseModuleInfo {
	stage: "initialization";
	success: false;
	error: ModuleSetupError;
	manifest: Readonly<ModuleManifest>;
}

export interface InitializedModuleInfo extends BaseModuleInfo {
	stage: "initialization";
	success: true;
	manifest: Readonly<ModuleManifest>;
	initTime: number;
}
