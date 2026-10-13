import * as fs from "./fs.ts";
import * as utils from "./utils.ts";
import type {
	Entry,
	WalkOptions,
	WriteOptions,
	WatchEvent,
	WatchOptions,
} from "./types.ts";
import type { Stats } from "node:fs";

abstract class EntryRef {
	readonly path: string;
	constructor(path: string) {
		this.path = path;
	}

	get name() {
		return utils.basename(this.path);
	}
	get stem() {
		return utils.stem(this.path);
	}
	get ext() {
		return utils.ext(this.path);
	}
	get absolute() {
		return utils.resolve(this.path);
	}
	get posix() {
		return utils.toPosix(this.path);
	}
	parent(): DirRef {
		return new DirRef(utils.dirname(this.path));
	}
	relativeTo(base: string | EntryRef) {
		return utils.relative(String(base), this.path);
	}
	isInside(parent: string | EntryRef) {
		return utils.isInside(String(parent), this.path);
	}
	toString() {
		return this.path;
	}

	exists() {
		return fs.exists(this.path);
	}
	stat(): Promise<Stats | null> {
		return fs.stat(this.path);
	}
	mtime() {
		return fs.mtime(this.path);
	}
	size() {
		return fs.sizeOf(this.path);
	}

	remove() {
		return fs.remove(this.path);
	}
	watch(cb: (e: WatchEvent) => void, opts?: WatchOptions) {
		return fs.watch(this.path, cb, opts);
	}
}

export class FileRef extends EntryRef {
	text() {
		return fs.readText(this.path);
	}
	textOrNull() {
		return fs.readTextOrNull(this.path);
	}
	bytes() {
		return fs.readBytes(this.path);
	}
	json<T = unknown>() {
		return fs.readJson<T>(this.path);
	}
	jsonOr<T>(fallback: T) {
		return fs.readJsonOr<T>(this.path, fallback);
	}
	lines() {
		return fs.readLines(this.path);
	}

	write(data: string | Uint8Array, opts?: WriteOptions) {
		return fs.write(this.path, data, opts);
	}
	writeJson(value: unknown, indent?: number) {
		return fs.writeJson(this.path, value, indent);
	}
	append(text: string) {
		return fs.appendText(this.path, text);
	}
	updateText(fn: (s: string) => string | Promise<string>) {
		return fs.updateText(this.path, fn);
	}
	updateJson<T>(fn: (v: T | null) => T | Promise<T>): Promise<void>;
	updateJson<T>(fn: (v: T) => T | Promise<T>, fallback: T): Promise<void>;
	updateJson<T>(fn: (v: T | null) => T | Promise<T>, fallback?: T) {
		return fs.updateJson(this.path, fn, fallback ?? null);
	}
	ensure(content = "") {
		return fs.ensureFile(this.path, content);
	}
	touch() {
		return fs.touch(this.path);
	}

	async move(dest: string | EntryRef, opts?: { overwrite?: boolean }) {
		await fs.move(this.path, String(dest), opts);
		return new FileRef(String(dest));
	}
	rename(newName: string) {
		return this.move(utils.withName(this.path, newName));
	}
	withExt(newExt: string) {
		return this.move(utils.changeExt(this.path, newExt));
	}
	async copy(dest: string | EntryRef, opts?: { overwrite?: boolean }) {
		await fs.copy(this.path, String(dest), opts);
		return new FileRef(String(dest));
	}

	sibling(name: string) {
		return new FileRef(utils.withName(this.path, name));
	}
	withExtRef(newExt: string) {
		return new FileRef(utils.changeExt(this.path, newExt));
	}
}

export class DirRef extends EntryRef {
	file(...parts: string[]) {
		return new FileRef(utils.join(this.path, ...parts));
	}
	dir(...parts: string[]) {
		return new DirRef(utils.join(this.path, ...parts));
	}

	entries(opts?: WalkOptions): Promise<Entry[]> {
		return fs.list(this.path, opts);
	}
	walk(opts?: WalkOptions) {
		return fs.walk(this.path, opts);
	}
	async files(opts?: Omit<WalkOptions, "type">) {
		return (await fs.listFiles(this.path, opts)).map(p => new FileRef(p));
	}
	async dirs(opts?: Omit<WalkOptions, "type">) {
		return (await fs.listDirs(this.path, opts)).map(p => new DirRef(p));
	}
	names() {
		return fs.readDir(this.path);
	}

	ensure() {
		return fs.ensureDir(this.path);
	}
	empty() {
		return fs.emptyDir(this.path);
	}
	async move(dest: string | EntryRef, opts?: { overwrite?: boolean }) {
		await fs.move(this.path, String(dest), opts);
		return new DirRef(String(dest));
	}
	rename(newName: string) {
		return this.move(utils.withName(this.path, newName));
	}
	async copy(dest: string | EntryRef, opts?: { overwrite?: boolean }) {
		await fs.copy(this.path, String(dest), opts);
		return new DirRef(String(dest));
	}
}

export async function ref(p: string): Promise<FileRef | DirRef | null> {
	const s = await fs.stat(p);
	if (!s) return null;
	return s.isDirectory() ? new DirRef(p) : new FileRef(p);
}

export const file = (...parts: string[]) => new FileRef(utils.join(...parts));
export const dir = (...parts: string[]) => new DirRef(utils.join(...parts));
