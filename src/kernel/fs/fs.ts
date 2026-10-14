import { promises as fsp, watch as nodeWatch } from "node:fs";
import type { Dirent, Stats } from "node:fs";
import * as nodePath from "node:path";
import { randomBytes } from "node:crypto";
import type {
	Entry,
	EntryType,
	WalkOptions,
	WatchEvent,
	WatchOptions,
	WriteOptions,
	FileSystemOperation,
	WatchUnsubscribe,
} from "./types.ts";
import {
	dirname,
	ext,
	join,
	normExt,
	resolve,
	segments,
	stem,
} from "./utils.ts";

import {
	FileAlreadyExistsError,
	FileNotFoundError,
	FileSystemOperationError,
	FileSystemPermissionError,
} from "./errors.ts";
import { getSystemErrorName } from "node:util";

export const APP_PATH = resolve(import.meta.dirname, "../../../");

// For some reason, the error numbers sometimes are positive instead of negative. TODO
// https://stackoverflow.com/questions/78457270/node-why-are-os-constants-errno-values-positive-while-util-getsystemerrorna
const errCode = (e: unknown) =>
	(e as NodeJS.ErrnoException).errno
		? getSystemErrorName(-Math.abs((e as NodeJS.ErrnoException).errno!))
		: "";

const toFileSystemError = (
	e: unknown,
	path: string,
	operation: FileSystemOperation,
): Error => {
	if (e instanceof FileSystemOperationError) return e;

	switch (errCode(e)) {
		case "ENOENT":
		case "ENOTDIR":
			return new FileNotFoundError(path, operation, e);

		case "EEXIST":
			return new FileAlreadyExistsError(path, operation, e);

		case "EACCES":
		case "EPERM":
			return new FileSystemPermissionError(path, operation, e);

		default:
			return new FileSystemOperationError(path, operation, e);
	}
};

export const isNotFound = (e: unknown) =>
	e instanceof FileNotFoundError ||
	errCode(e) === "ENOENT" ||
	errCode(e) === "ENOTDIR";

export const isExists = (e: unknown) =>
	e instanceof FileAlreadyExistsError || errCode(e) === "EEXIST";

export async function stat(p: string): Promise<Stats | null> {
	try {
		return await fsp.stat(p);
	} catch (e) {
		if (isNotFound(e)) return null;
		throw e;
	}
}

export async function exists(p: string): Promise<boolean> {
	return (await stat(p)) !== null;
}

export async function isFile(p: string): Promise<boolean> {
	return (await stat(p))?.isFile() ?? false;
}

export async function isDir(p: string): Promise<boolean> {
	return (await stat(p))?.isDirectory() ?? false;
}

export async function mtime(p: string): Promise<Date | null> {
	return (await stat(p))?.mtime ?? null;
}

export async function size(p: string): Promise<number | null> {
	return (await stat(p))?.size ?? null;
}

export async function readText(
	p: string,
	encoding: BufferEncoding = "utf8",
): Promise<string> {
	try {
		return await fsp.readFile(p, { encoding });
	} catch (e) {
		throw toFileSystemError(e, p, "read");
	}
}

export function readBytes(p: string): Promise<Buffer> {
	return fsp.readFile(p);
}

export async function readJson<T = unknown>(p: string): Promise<T> {
	return JSON.parse(await readText(p)) as T; // wrap errors
}

// maybe this could be a generator?
export async function readLines(p: string): Promise<string[]> {
	return (await readText(p)).split(/\r?\n/);
}

export async function readTextOrNull(p: string): Promise<string | null> {
	try {
		return await readText(p);
	} catch (e) {
		if (isNotFound(e)) return null;
		throw e;
	}
}
export async function readJsonOr<T>(p: string, fallback: T): Promise<T> {
	try {
		return await readJson<T>(p);
	} catch (e) {
		if (isNotFound(e)) return fallback;
		throw e;
	}
}

export async function write(
	p: string,
	data: string | Uint8Array,
	{ atomic = true, mkdirs = true, encoding = "utf8" }: WriteOptions = {},
): Promise<void> {
	try {
		if (mkdirs) await ensureDir(nodePath.dirname(p));

		if (!atomic) {
			await fsp.writeFile(
				p,
				data,
				typeof data === "string" ? { encoding } : undefined,
			);
			return;
		}

		const tmp = `${p}.${randomBytes(4).toString("hex")}.tmp`;

		try {
			await fsp.writeFile(
				tmp,
				data,
				typeof data === "string" ? { encoding } : undefined,
			);
			await fsp.rename(tmp, p);
		} catch (e) {
			await fsp.rm(tmp, { force: true });
			throw e;
		}
	} catch (e) {
		throw toFileSystemError(e, p, "write");
	}
}

export const writeText = write;
export const writeBytes = write;

export function writeJson(
	p: string,
	value: unknown,
	indent = 2,
	opts?: WriteOptions,
): Promise<void> {
	return write(p, JSON.stringify(value, null, indent) + "\n", opts);
}

export async function appendText(p: string, text: string): Promise<void> {
	try {
		await ensureDir(nodePath.dirname(p));
		await fsp.appendFile(p, text);
	} catch (e) {
		throw toFileSystemError(e, p, "append");
	}
}

export async function updateText(
	p: string,
	fn: (current: string) => string | Promise<string>,
): Promise<void> {
	await write(p, await fn(await readText(p)));
}

// One thing that bugs me is that updateJson() has fallback logic, but
// updateText just throws if there is no file TODO

export async function updateJson<T>(
	p: string,
	fn: (current: T | null) => T | Promise<T>,
): Promise<void>;
export async function updateJson<T>(
	p: string,
	fn: (current: T) => T | Promise<T>,
	fallback: T,
): Promise<void>;
export async function updateJson<T>(
	p: string,
	fn: (current: T) => T | Promise<T>,
	fallback?: T,
): Promise<void> {
	const current =
		fallback === undefined
			? await readJson<T>(p)
			: await readJsonOr<T>(p, fallback);
	await writeJson(p, await fn(current));
}

export async function ensureDir(p: string): Promise<void> {
	await fsp.mkdir(p, { recursive: true });
}

export async function ensureFile(p: string, content = ""): Promise<void> {
	await ensureDir(nodePath.dirname(p));
	try {
		await fsp.writeFile(p, content, { flag: "wx" });
	} catch (e) {
		if (!isExists(e)) throw e;
	}
}

export async function touch(p: string): Promise<void> {
	await ensureFile(p);
	const now = new Date();
	await fsp.utimes(p, now, now);
}

export async function remove(p: string): Promise<void> {
	await fsp.rm(p, { recursive: true, force: true });
}

export async function emptyDir(p: string): Promise<void> {
	await ensureDir(p);
	for (const e of await list(p, { maxDepth: 1 })) await remove(e.path);
}

export async function copy(
	src: string,
	dest: string,
	{ overwrite = false } = {},
): Promise<void> {
	try {
		await ensureDir(nodePath.dirname(dest));
		await fsp.cp(src, dest, {
			recursive: true,
			force: overwrite,
			errorOnExist: !overwrite,
		});
	} catch (e) {
		throw toFileSystemError(e, dest, "copy");
	}
}

export async function move(
	src: string,
	dest: string,
	{ overwrite = false } = {},
): Promise<void> {
	try {
		if (!overwrite && (await exists(dest))) {
			throw new FileAlreadyExistsError(dest, "move");
		}

		await ensureDir(nodePath.dirname(dest));

		try {
			await fsp.rename(src, dest);
		} catch (e) {
			if (errCode(e) !== "EXDEV") throw e;
			await copy(src, dest, { overwrite: true });
			await remove(src);
		}
	} catch (e) {
		if (e instanceof FileAlreadyExistsError) throw e;
		throw toFileSystemError(e, src, "move");
	}
}

function toEntry(dir: string, d: Dirent): Entry {
	const type: EntryType = d.isFile()
		? "file"
		: d.isDirectory()
			? "dir"
			: d.isSymbolicLink()
				? "symlink"
				: "other";
	return { path: nodePath.join(dir, d.name), name: d.name, type };
}

export async function* walk(
	root: string,
	opts: WalkOptions = {},
): AsyncGenerator<Entry> {
	const {
		recursive = true,
		maxDepth = Infinity,
		hidden = true,
		ignore = [],
		type = null,
		exts = null,
		filter = () => true,
	} = opts;
	const extensions = exts ? exts.map(normExt) : null;
	async function* inner(dir: string, depth: number): AsyncGenerator<Entry> {
		const dirents = await fsp.readdir(dir, { withFileTypes: true });
		dirents.sort((a, b) => a.name.localeCompare(b.name));
		for (const d of dirents) {
			if (!hidden && d.name.startsWith(".")) continue;
			if (ignore.includes(d.name)) continue;
			const entry = toEntry(dir, d);
			if (!filter(entry)) continue;
			if (
				(!type || entry.type == type) &&
				(!extensions ||
					(entry.type === "file" &&
						extensions.includes(ext(entry.name).toLowerCase())))
			)
				yield entry;
			if (entry.type === "dir" && recursive && depth < maxDepth)
				yield* inner(entry.path, depth + 1);
		}
	}
	yield* inner(root, 1);
}

export async function list(
	root: string,
	opts: WalkOptions = {},
): Promise<Entry[]> {
	const out: Entry[] = [];
	for await (const e of walk(root, opts)) out.push(e);
	return out;
}

export async function listFiles(
	root: string,
	opts: Omit<WalkOptions, "type"> = {},
): Promise<string[]> {
	return (await list(root, { ...opts, type: "file" })).map(e => e.path);
}

export async function listDirs(
	root: string,
	opts: Omit<WalkOptions, "type"> = {},
): Promise<string[]> {
	return (await list(root, { ...opts, type: "dir" })).map(e => e.path);
}

export async function readDir(p: string): Promise<string[]> {
	return (await fsp.readdir(p)).sort((a, b) => a.localeCompare(b));
}

export async function uniquePath(p: string): Promise<string> {
	if (!(await exists(p))) return p;
	const dir = nodePath.dirname(p);
	const e = ext(p);
	const s = stem(p);
	for (let i = 1; ; i++) {
		const candidate = nodePath.join(dir, `${s} (${i})${e}`);
		if (!(await exists(candidate))) return candidate;
	}
}

export async function sizeOf(p: string): Promise<number> {
	const s = await stat(p);
	if (!s) return 0;
	if (s.isFile()) return s.size;
	let total = 0;
	for await (const e of walk(p))
		if (e.type === "file") total += (await stat(e.path))?.size ?? 0;
	return total;
}

// TODO when doing a lot of fs operation at the same time (e.g create 2 files,
// rename one and delete the other at the same time), some events might get lost
// (for some reason??)
export async function watch(
	root: string,
	callback: (e: WatchEvent) => void,
	opts: WatchOptions = {},
): Promise<WatchUnsubscribe> {
	const { recursive = true, ignore = [] } = opts;
	const known = new Set<string>();

	if (await isDir(root))
		for await (const entry of walk(root, { recursive }))
			known.add(entry.path);
	else if (await exists(root)) known.add(segments(root).at(-1)!);

	const parentDir = dirname(root);

	const handle = async (fileName: string) => {
		if (known.has(fileName)) {
			if (await exists(join(parentDir, fileName))) {
				callback({ type: "change", path: fileName });
			} else {
				callback({ type: "remove", path: fileName });
				known.delete(fileName);
			}
		} else {
			if (await exists(join(parentDir, fileName))) {
				callback({ type: "add", path: fileName });
				known.add(fileName);
			}
		}
	};

	let last: string | null;
	let lastTime = process.hrtime.bigint();
	const watcher = nodeWatch(
		parentDir,
		{ recursive: true },
		async (event, fileName) => {
			if (!fileName) return;

			if (segments(fileName)[0] != segments(root).at(-1)) return;

			// 2 segments: root/file
			if (!recursive && segments(fileName).length > 2) return;

			if (
				ignore.some(i =>
					join(parentDir, fileName).startsWith(join(root, i)),
				)
			)
				return;

			if (event == "change") {
				callback({ type: "change", path: fileName });
				return;
			}

			// TODO this is ugly
			if (process.hrtime.bigint() - lastTime > 100000000) last = null;

			if (last) {
				const oe = await exists(join(parentDir, last));
				const ne = await exists(join(parentDir, fileName));

				if (!oe && ne) {
					callback({
						type: "rename",
						from: last,
						path: fileName,
					});
					known.delete(last);
					known.add(fileName);
				} else {
					handle(last);
					handle(fileName);
				}
			} else {
				handle(fileName);
			}

			last = fileName;
			lastTime = process.hrtime.bigint();
		},
	);

	return () => watcher.close();
}
