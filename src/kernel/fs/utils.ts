import * as nodePath from "node:path";

export const normExt = (e: string) =>
	(e.startsWith(".") ? e : "." + e).toLowerCase();

export const join = nodePath.join;
export const resolve = nodePath.resolve;
export const relative = nodePath.relative;
export const normalize = nodePath.normalize;
export const dirname = nodePath.dirname;
export const basename = nodePath.basename;
export const isAbsolute = nodePath.isAbsolute;
export const sep = nodePath.sep;

export const ext = (p: string) => nodePath.extname(p);

export const stem = (p: string) => nodePath.basename(p, nodePath.extname(p));

export function changeExt(p: string, newExt: string): string {
	const e = newExt === "" ? "" : normExt(newExt);
	return nodePath.join(nodePath.dirname(p), stem(p) + e);
}

export const withName = (p: string, name: string) =>
	nodePath.join(nodePath.dirname(p), name);

export const withStem = (p: string, s: string) =>
	nodePath.join(nodePath.dirname(p), s + ext(p));

export const toPosix = (p: string) => p.split(nodePath.sep).join("/");

export function isInside(parent: string, child: string): boolean {
	const rel = nodePath.relative(
		nodePath.resolve(parent),
		nodePath.resolve(child),
	);
	return rel === "" || (!rel.startsWith("..") && !nodePath.isAbsolute(rel));
}

export const segments = (p: string) =>
	toPosix(nodePath.normalize(p)).split("/").filter(Boolean);

export function sanitizeName(name: string, replacement = "-"): string {
	return name
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, replacement)
		.replace(/^\.+/, "")
		.replace(/[. ]+$/, "")
		.trim();
}
