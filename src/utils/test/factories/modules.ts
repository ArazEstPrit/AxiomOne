import { join } from "path";
import { mkdirSync, writeFileSync } from "fs";
import { absoluteModulePath, type ModuleManifest } from "#kernel/modules";

declare global {
	interface __test {
		modules: string[];
	}
}

export function createModule(
	name: string,
	manifest?: (Record<string, string> & Partial<ModuleManifest>) | undefined,
	code?: string,
	options?: { codeFileName?: string; exactCode?: boolean }
) {
	const modulePath = join(absoluteModulePath, name);
	mkdirSync(modulePath, { recursive: true });
	if (manifest) createManifest(name, JSON.stringify(manifest));

	if (code)
		writeFileSync(
			join(
				modulePath,
				options?.codeFileName || manifest?.entry || "index.ts"
			),
			options?.exactCode ? code : `export async function init() {${code}}`
		);
}

export function createNormalModules(num: number = 1) {
	for (let i = 0; i < num; i++)
		createModule(
			"test-module-" + i,
			createNormalManifest(i),
			`global.__test.modules.push('test-module-${i}');`
		);
}

export function createNormalManifest(num: number) {
	return {
		name: "test-module-" + num,
		description: "Test module description",
		displayName: "Test Module " + num,
		entry: "index.ts",
	};
}

export function createManifest(moduleName: string, manifest: string) {
	writeFileSync(
		join(absoluteModulePath, moduleName, "manifest.json"),
		manifest
	);
}
