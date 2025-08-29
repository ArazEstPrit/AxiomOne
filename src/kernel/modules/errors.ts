import type { ModuleManifest, ModuleSetupStage } from "./types.ts";

export class ModuleSetupError extends Error {
	stage: ModuleSetupStage;
	module: string;
	constructor(
		message: string,
		module: string,
		stage: ModuleSetupStage,
		cause?: unknown
	) {
		super(message, { cause });
		this.name = "ModuleSetupError";
		this.stage = stage;
		this.module = module;
	}
}

export class ModuleDiscoveryError extends ModuleSetupError {
	constructor(module: string, cause?: unknown) {
		super(
			`Failed to discover module "${module}"`,
			module,
			"discovery",
			cause
		);
		this.name = "ModuleDiscoveryError";
	}
}

export class ModuleValidationError extends ModuleSetupError {
	constructor(message: string, module: string, cause?: unknown) {
		super(message, module, "validation", cause);
		this.name = "ModuleValidationError";
	}
}

export class ManifestMissingFieldError extends ModuleValidationError {
	constructor(module: string, field: keyof ModuleManifest) {
		super(
			`Manifest for module "${module}" is missing required field "${field}"`,
			module
		);
		this.name = "ManifestMissingFieldError";
	}
}

export class ManifestNameMismatchError extends ModuleValidationError {
	constructor(dirName: string, manifestName: string) {
		super(
			`Manifest name "${manifestName}" does not match folder name "${dirName}"`,
			dirName
		);
		this.name = "ManifestNameMismatchError";
	}
}

export class ManifestEntryNotFoundError extends ModuleValidationError {
	constructor(module: string, entry: string) {
		super(
			`Manifest entry file "${entry}" not found for module "${module}"`,
			module
		);
		this.name = "ManifestEntryNotFoundError";
	}
}

export class ModuleLoadError extends ModuleSetupError {
	constructor(module: string, cause?: unknown) {
		super(`Failed to load module "${module}"`, module, "loading", cause);
		this.name = "ModuleLoadError";
	}
}

export class EntryPointMissingInitError extends ModuleLoadError {
	constructor(module: string) {
		super(module);
		this.message = `Entry point for module "${module}" does not export an 'init' function`;
		this.name = "EntryPointMissingInitError";
	}
}

export class ModuleInitializationError extends ModuleSetupError {
	constructor(module: string, cause?: unknown) {
		super(
			`Initialization failed for module "${module}"`,
			module,
			"initialization",
			cause
		);
		this.name = "ModuleInitializationError";
	}
}
