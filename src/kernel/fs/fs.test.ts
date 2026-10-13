import { deepStrictEqual, ok, strictEqual } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
	mkdir,
	mkdtemp,
	readdir,
	rm,
	stat as nodeStat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	FileAlreadyExistsError,
	FileNotFoundError,
	FileSystemOperationError,
} from "./errors.ts";
import {
	appendText,
	copy,
	emptyDir,
	ensureDir,
	ensureFile,
	exists,
	isDir,
	isFile,
	list,
	listDirs,
	listFiles,
	mtime,
	move,
	readBytes,
	readDir,
	readJson,
	readJsonOr,
	readLines,
	readText,
	readTextOrNull,
	remove,
	size,
	sizeOf,
	stat,
	touch,
	uniquePath,
	updateJson,
	updateText,
	walk,
	write,
	writeJson,
} from "./fs.ts";
import { dir, file, ref, DirRef, FileRef } from "./helpers.ts";
import type { WatchEvent } from "./types.ts";
import { wait } from "#utils";

const WATCH_EVENT_WAIT_MS = 10;
const waitTillEvent = async (events: WatchEvent[]) => {
	let c = 0;
	while (!events.length && c < 100) {
		await wait(WATCH_EVENT_WAIT_MS);
		c++;
	}
};

describe("Kernel.FS", () => {
	let root: string;

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "kernel-fs-test-"));
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	describe(".stat()", () => {
		it("should return stats for an existing file", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "hello");

			const result = await stat(p);

			ok(result);
			strictEqual(result.isFile(), true);
			strictEqual(result.size, 5);
		});

		it("should return stats for an existing directory", async () => {
			const p = join(root, "dir");
			await mkdir(p);

			const result = await stat(p);

			ok(result);
			strictEqual(result.isDirectory(), true);
		});

		it("should return null for a missing path", async () => {
			strictEqual(await stat(join(root, "missing")), null);
		});

		it("should make exists, isFile and isDir agree with stat", async () => {
			const filePath = join(root, "file.txt");
			const dirPath = join(root, "dir");
			const missingPath = join(root, "missing");

			await writeFile(filePath, "hello");
			await mkdir(dirPath);

			strictEqual(await exists(filePath), true);
			strictEqual(await isFile(filePath), true);
			strictEqual(await isDir(filePath), false);

			strictEqual(await exists(dirPath), true);
			strictEqual(await isFile(dirPath), false);
			strictEqual(await isDir(dirPath), true);

			strictEqual(await exists(missingPath), false);
			strictEqual(await isFile(missingPath), false);
			strictEqual(await isDir(missingPath), false);
		});

		it("should return null for mtime and size of a missing path", async () => {
			const p = join(root, "missing");

			strictEqual(await mtime(p), null);
			strictEqual(await size(p), null);
		});
	});

	describe(".readText()", () => {
		it("should read UTF-8 text", async () => {
			const p = join(root, "hello.txt");
			await writeFile(p, "hello world");

			strictEqual(await readText(p), "hello world");
		});

		it("should support alternate encodings", async () => {
			const p = join(root, "hello.txt");
			await writeFile(p, Buffer.from("hello"));

			strictEqual(await readText(p, "utf8"), "hello");
		});

		it("should throw FileNotFoundError for a missing file", async () => {
			const p = join(root, "missing.txt");

			await readText(p).then(
				() => {
					throw new Error("expected readText to reject");
				},
				e => {
					ok(e instanceof FileNotFoundError);
					strictEqual((e as FileNotFoundError).path, p);
					strictEqual((e as FileNotFoundError).operation, "read");
					strictEqual((e as FileNotFoundError).code, "ENOENT");
				},
			);
		});
	});

	describe(".readBytes()", () => {
		it("should preserve file bytes exactly", async () => {
			const p = join(root, "data.bin");
			const data = Buffer.from([0, 1, 2, 127, 128, 255]);

			await writeFile(p, data);

			deepStrictEqual(await readBytes(p), data);
		});
	});

	describe(".readJson()", () => {
		it("should parse JSON", async () => {
			const p = join(root, "data.json");
			await writeFile(p, '{"name":"test","count":2}');

			deepStrictEqual(await readJson(p), {
				name: "test",
				count: 2,
			});
		});

		it("should reject malformed JSON", async () => {
			const p = join(root, "data.json");
			await writeFile(p, '{"broken":');

			await readJson(p).then(
				() => {
					throw new Error("expected readJson to reject");
				},
				e => {
					ok(e instanceof SyntaxError);
				},
			);
		});
	});

	describe(".readJsonOr()", () => {
		it("should return the fallback when the file is missing", async () => {
			const p = join(root, "missing.json");

			deepStrictEqual(await readJsonOr(p, { value: 10 }), { value: 10 });
		});

		it("should return the parsed value when the file exists", async () => {
			const p = join(root, "data.json");
			await writeFile(p, '{"value":20}');

			deepStrictEqual(await readJsonOr(p, { value: 10 }), { value: 20 });
		});

		it("should not use the fallback for malformed JSON", async () => {
			const p = join(root, "data.json");
			await writeFile(p, '{"broken":');

			await readJsonOr(p, { value: 10 }).then(
				() => {
					throw new Error("expected readJsonOr to reject");
				},
				e => {
					ok(e instanceof SyntaxError);
				},
			);
		});
	});

	describe(".readTextOrNull()", () => {
		it("should return null when the file is missing", async () => {
			strictEqual(await readTextOrNull(join(root, "missing.txt")), null);
		});

		it("should return the text when the file exists", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "hello");

			strictEqual(await readTextOrNull(p), "hello");
		});

		it("should rethrow non-not-found errors", async () => {
			const p = join(root, "directory");
			await mkdir(p);

			await readTextOrNull(p).then(
				() => {
					throw new Error("expected readTextOrNull to reject");
				},
				e => {
					ok(e instanceof FileSystemOperationError);
				},
			);
		});
	});

	describe(".readLines()", () => {
		it("should split LF-separated lines", async () => {
			const p = join(root, "lines.txt");
			await writeFile(p, "one\ntwo\nthree");

			deepStrictEqual(await readLines(p), ["one", "two", "three"]);
		});

		it("should split CRLF-separated lines", async () => {
			const p = join(root, "lines.txt");
			await writeFile(p, "one\r\ntwo\r\nthree");

			deepStrictEqual(await readLines(p), ["one", "two", "three"]);
		});

		it("should preserve an empty final line", async () => {
			const p = join(root, "lines.txt");
			await writeFile(p, "one\ntwo\n");

			deepStrictEqual(await readLines(p), ["one", "two", ""]);
		});
	});

	describe(".write()", () => {
		it("should create missing parent directories by default", async () => {
			const p = join(root, "a", "b", "file.txt");

			await write(p, "hello");

			strictEqual(await readText(p), "hello");
		});

		it("should overwrite an existing file", async () => {
			const p = join(root, "file.txt");

			await write(p, "first");
			await write(p, "second");

			strictEqual(await readText(p), "second");
		});

		it("should write Uint8Array data", async () => {
			const p = join(root, "data.bin");
			const data = new Uint8Array([1, 2, 3, 4]);

			await write(p, data);

			deepStrictEqual(await readBytes(p), Buffer.from(data));
		});

		it("should fail when mkdirs is disabled and the parent is missing", async () => {
			const p = join(root, "missing", "file.txt");

			await write(p, "hello", { mkdirs: false }).then(
				() => {
					throw new Error("expected write to reject");
				},
				e => {
					ok(e instanceof FileNotFoundError);
					strictEqual((e as FileNotFoundError).operation, "write");
				},
			);
		});

		it("should support non-atomic writes", async () => {
			const p = join(root, "file.txt");

			await write(p, "hello", { atomic: false });

			strictEqual(await readText(p), "hello");
		});

		it("should clean up temporary files after a successful atomic write", async () => {
			const p = join(root, "file.txt");

			await write(p, "hello");

			deepStrictEqual(await readdir(root), ["file.txt"]);
		});
	});

	describe(".writeJson()", () => {
		it("should write formatted JSON followed by a newline", async () => {
			const p = join(root, "data.json");

			await writeJson(p, { name: "test", values: [1, 2] });

			strictEqual(
				await readText(p),
				'{\n  "name": "test",\n  "values": [\n    1,\n    2\n  ]\n}\n',
			);
		});

		it("should support a custom indentation level", async () => {
			const p = join(root, "data.json");

			await writeJson(p, { value: 1 }, 4);

			strictEqual(await readText(p), '{\n    "value": 1\n}\n');
		});
	});

	describe(".appendText()", () => {
		it("should append to an existing file", async () => {
			const p = join(root, "file.txt");

			await write(p, "hello");
			await appendText(p, " world");

			strictEqual(await readText(p), "hello world");
		});

		it("should create parent directories", async () => {
			const p = join(root, "a", "file.txt");

			await appendText(p, "hello");

			strictEqual(await readText(p), "hello");
		});
	});

	describe(".updateText()", () => {
		it("should update text using a synchronous callback", async () => {
			const p = join(root, "file.txt");

			await write(p, "hello");

			await updateText(p, current => current.toUpperCase());

			strictEqual(await readText(p), "HELLO");
		});

		it("should support an asynchronous callback", async () => {
			const p = join(root, "file.txt");

			await write(p, "hello");

			await updateText(p, async current => `${current} world`);

			strictEqual(await readText(p), "hello world");
		});
	});

	describe(".updateJson()", () => {
		it("should update an existing JSON value", async () => {
			const p = join(root, "data.json");

			await writeJson(p, { count: 1 });

			await updateJson<{ count: number }>(
				p,
				value => ({
					count: value.count + 1,
				}),
				{ count: 0 },
			);

			deepStrictEqual(await readJson(p), { count: 2 });
		});

		it("should use the fallback when the JSON file is missing", async () => {
			const p = join(root, "data.json");

			await updateJson(
				p,
				(value: { count: number }) => ({
					count: value.count + 1,
				}),
				{ count: 10 },
			);

			deepStrictEqual(await readJson(p), { count: 11 });
		});

		it("should support an asynchronous callback", async () => {
			const p = join(root, "data.json");

			await writeJson(p, { count: 1 });

			await updateJson<{ count: number }>(
				p,
				async value => ({
					count: value.count + 2,
				}),
				{ count: 0 },
			);

			deepStrictEqual(await readJson(p), { count: 3 });
		});
	});

	describe(".ensureDir()", () => {
		it("should create a directory recursively", async () => {
			const p = join(root, "a", "b", "c");

			await ensureDir(p);

			strictEqual(await isDir(p), true);
		});

		it("should be idempotent", async () => {
			const p = join(root, "dir");

			await ensureDir(p);
			await ensureDir(p);

			strictEqual(await isDir(p), true);
		});

		it("should keep directory contents if it already exists", async () => {
			const d = dir(root, "dir");

			await d.file("test1").write("");
			await d.file("test2").write("");

			await ensureDir(join(root, "dir"));

			deepStrictEqual(await readdir(join(root, "dir")), [
				"test1",
				"test2",
			]);
		});
	});

	describe(".ensureFile()", () => {
		it("should create the file and parent directories", async () => {
			const p = join(root, "a", "b", "file.txt");

			await ensureFile(p, "hello");

			strictEqual(await readText(p), "hello");
		});

		it("should not overwrite an existing file", async () => {
			const p = join(root, "file.txt");

			await writeFile(p, "original");

			await ensureFile(p, "replacement");

			strictEqual(await readText(p), "original");
		});

		it("should be idempotent", async () => {
			const p = join(root, "file.txt");

			await ensureFile(p, "hello");
			await ensureFile(p, "world");

			strictEqual(await readText(p), "hello");
		});
	});

	describe(".touch()", () => {
		it("should create a missing file", async () => {
			const p = join(root, "file.txt");

			await touch(p);

			strictEqual(await exists(p), true);
			strictEqual(await readText(p), "");
		});

		it("should update the modification time of an existing file", async () => {
			const p = join(root, "file.txt");

			await writeFile(p, "hello");

			const before = await nodeStat(p);
			await new Promise(resolve => setTimeout(resolve, 10));
			await touch(p);
			const after = await nodeStat(p);

			ok(after.mtimeMs >= before.mtimeMs);
		});
	});

	describe(".remove()", () => {
		it("should remove a file", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "hello");

			await remove(p);

			strictEqual(await exists(p), false);
		});

		it("should recursively remove a directory", async () => {
			const p = join(root, "dir", "nested");
			await mkdir(p, { recursive: true });
			await writeFile(join(p, "file.txt"), "hello");

			await remove(join(root, "dir"));

			strictEqual(await exists(join(root, "dir")), false);
		});

		it("should be safe for a missing path", async () => {
			await remove(join(root, "missing"));
		});
	});

	describe(".emptyDir()", () => {
		it("should remove all direct and nested contents while keeping the directory", async () => {
			const p = join(root, "dir");
			await mkdir(join(p, "nested"), { recursive: true });
			await writeFile(join(p, "file.txt"), "hello");
			await writeFile(join(p, "nested", "nested.txt"), "nested");

			await emptyDir(p);

			strictEqual(await isDir(p), true);
			deepStrictEqual(await readdir(p), []);
		});

		it("should create a missing directory", async () => {
			const p = join(root, "missing");

			await emptyDir(p);

			strictEqual(await isDir(p), true);
		});
	});

	describe(".copy()", () => {
		it("should copy a file", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "destination.txt");

			await writeFile(src, "hello");

			await copy(src, dest);

			strictEqual(await readText(dest), "hello");
			strictEqual(await readText(src), "hello");
		});

		it("should copy a directory recursively", async () => {
			const src = join(root, "source");
			const dest = join(root, "destination");

			await mkdir(join(src, "nested"), { recursive: true });
			await writeFile(join(src, "one.txt"), "one");
			await writeFile(join(src, "nested", "two.txt"), "two");

			await copy(src, dest);

			strictEqual(await readText(join(dest, "one.txt")), "one");
			strictEqual(await readText(join(dest, "nested", "two.txt")), "two");
		});

		it("should create the destination parent directory", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "a", "b", "destination.txt");

			await writeFile(src, "hello");

			await copy(src, dest);

			strictEqual(await readText(dest), "hello");
		});

		it("should reject an existing destination by default", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "destination.txt");

			await writeFile(src, "source");
			await writeFile(dest, "destination");

			await copy(src, dest).then(
				() => {
					throw new Error("expected copy to reject");
				},
				e => {
					ok(e instanceof FileAlreadyExistsError);
					strictEqual(
						(e as FileAlreadyExistsError).operation,
						"copy",
					);
					strictEqual((e as FileAlreadyExistsError).path, dest);
				},
			);
		});

		it("should overwrite when overwrite is true", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "destination.txt");

			await writeFile(src, "source");
			await writeFile(dest, "destination");

			await copy(src, dest, { overwrite: true });

			strictEqual(await readText(dest), "source");
		});
	});

	describe(".move()", () => {
		it("should move a file", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "destination.txt");

			await writeFile(src, "hello");

			await move(src, dest);

			strictEqual(await exists(src), false);
			strictEqual(await readText(dest), "hello");
		});

		it("should create the destination parent directory", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "a", "b", "destination.txt");

			await writeFile(src, "hello");

			await move(src, dest);

			strictEqual(await readText(dest), "hello");
		});

		it("should reject an existing destination by default", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "destination.txt");

			await writeFile(src, "source");
			await writeFile(dest, "destination");

			await move(src, dest).then(
				() => {
					throw new Error("expected move to reject");
				},
				e => {
					ok(e instanceof FileAlreadyExistsError);
					strictEqual(
						(e as FileAlreadyExistsError).operation,
						"move",
					);
				},
			);

			strictEqual(await readText(src), "source");
			strictEqual(await readText(dest), "destination");
		});

		it("should overwrite when overwrite is true", async () => {
			const src = join(root, "source.txt");
			const dest = join(root, "destination.txt");

			await writeFile(src, "source");
			await writeFile(dest, "destination");

			await move(src, dest, { overwrite: true });

			strictEqual(await exists(src), false);
			strictEqual(await readText(dest), "source");
		});
	});

	describe(".walk()", () => {
		it("should recursively walk entries in alphabetical order", async () => {
			const a = join(root, "a");
			const b = join(root, "b");
			const nested = join(a, "nested");

			await mkdir(b, { recursive: true });
			await mkdir(nested, { recursive: true });
			await writeFile(join(a, "z.txt"), "z");
			await writeFile(join(a, "a.txt"), "a");
			await writeFile(join(b, "file.txt"), "b");

			const entries = [];
			for await (const entry of walk(root)) entries.push(entry);

			deepStrictEqual(
				entries.map(e => e.path),
				[
					a,
					join(a, "a.txt"),
					nested,
					join(a, "z.txt"),
					b,
					join(b, "file.txt"),
				],
			);
		});

		it("should include entry type and name", async () => {
			const dirPath = join(root, "dir");
			const filePath = join(root, "file.txt");

			await mkdir(dirPath);
			await writeFile(filePath, "hello");

			const entries = [];
			for await (const entry of walk(root)) {
				entries.push(entry);
			}

			deepStrictEqual(entries, [
				{
					path: dirPath,
					name: "dir",
					type: "dir",
				},
				{
					path: filePath,
					name: "file.txt",
					type: "file",
				},
			]);
		});

		it("should not recurse when recursive is false", async () => {
			const dirPath = join(root, "dir");
			await mkdir(dirPath);
			await writeFile(join(dirPath, "file.txt"), "hello");

			const entries = [];
			for await (const entry of walk(root, {
				recursive: false,
			})) {
				entries.push(entry);
			}

			deepStrictEqual(
				entries.map(e => e.path),
				[dirPath],
			);
		});

		it("should respect maxDepth", async () => {
			const level1 = join(root, "level1");
			const level2 = join(level1, "level2");
			const level3 = join(level2, "level3");

			await mkdir(level3, { recursive: true });
			await writeFile(join(level3, "file.txt"), "hello");

			const entries = [];
			for await (const entry of walk(root, {
				maxDepth: 2,
			})) {
				entries.push(entry);
			}

			deepStrictEqual(
				entries.map(e => e.path),
				[level1, level2],
			);
		});

		it("should exclude hidden entries when hidden is false", async () => {
			await mkdir(join(root, ".hidden"));
			await mkdir(join(root, "visible"));
			await writeFile(join(root, ".hidden", "file.txt"), "hidden");
			await writeFile(join(root, "visible", "file.txt"), "visible");

			const entries = [];
			for await (const entry of walk(root, {
				hidden: false,
			})) {
				entries.push(entry);
			}

			deepStrictEqual(
				entries.map(e => e.name),
				["visible", "file.txt"],
			);
		});

		it("should ignore matching entry names", async () => {
			await mkdir(join(root, "ignored"));
			await mkdir(join(root, "included"));
			await writeFile(join(root, "ignored", "file.txt"), "ignored");
			await writeFile(join(root, "included", "file.txt"), "included");

			const entries = [];
			for await (const entry of walk(root, {
				ignore: ["ignored"],
			})) {
				entries.push(entry);
			}

			deepStrictEqual(
				entries.map(e => e.name),
				["included", "file.txt"],
			);
		});

		it("should filter by type", async () => {
			await mkdir(join(root, "dir1"));
			await mkdir(join(root, "dir2"));
			await writeFile(join(root, "file1"), "");
			await writeFile(join(root, "file2"), "");
			await writeFile(join(root, "dir2", "file3"), "");

			const files = [];
			for await (const e of walk(root, { type: "file" })) files.push(e);
			const dirs = [];
			for await (const e of walk(root, { type: "dir" })) dirs.push(e);

			strictEqual(files.length, 3);
			strictEqual(dirs.length, 2);
		});

		it("should filter by extension", async () => {
			await writeFile(join(root, "package.json"), "");
			await writeFile(join(root, "readme.txt"), "");
			await writeFile(join(root, "build.sh"), "");
			await mkdir(join(root, "src"));
			await writeFile(join(root, "src", "main.ts"), "");
			await writeFile(join(root, "src", "something.ts"), "");
			await writeFile(join(root, "src", "utils.ts"), "");

			const entries = [];
			for await (const e of walk(root, { exts: ["ts", "sh"] }))
				entries.push(e.name);

			deepStrictEqual(entries, [
				"build.sh",
				"main.ts",
				"something.ts",
				"utils.ts",
			]);
		});

		it("should accept extensions with or without a dot", async () => {
			await writeFile(join(root, "package.json"), "");
			await writeFile(join(root, "readme.txt"), "");
			await writeFile(join(root, "build.sh"), "");
			await mkdir(join(root, "src"));
			await writeFile(join(root, "src", "main.ts"), "");
			await writeFile(join(root, "src", "something.ts"), "");
			await writeFile(join(root, "src", "utils.ts"), "");

			const withoutDot = [];
			for await (const e of walk(root, { exts: ["ts", ".sh"] }))
				withoutDot.push(e);

			const withDot = [];
			for await (const e of walk(root, { exts: [".ts", "sh"] }))
				withDot.push(e);

			deepStrictEqual(
				withoutDot.map(e => e.path),
				withDot.map(e => e.path),
			);
		});

		it("should normalize extension matching case-insensitively", async () => {
			await writeFile(join(root, "UPPER.TS"), "upper");

			const entries = [];
			for await (const e of walk(root, { exts: [".ts"] }))
				entries.push(e);

			ok(entries.some(e => e.name === "UPPER.TS"));
		});

		it("should apply a custom filter", async () => {
			await writeFile(join(root, "a.txt"), "");
			await writeFile(join(root, "another.txt"), "");
			await writeFile(join(root, "bnother.txt"), "");

			const entries = [];
			for await (const e of walk(root, {
				filter: entry => entry.name.startsWith("a"),
			}))
				entries.push(e);

			deepStrictEqual(
				entries.map(e => e.name),
				["a.txt", "another.txt"],
			);
		});
	});

	describe(".list()", () => {
		it("should be equivalent to walk()", async () => {
			await mkdir(join(root, "dir"));
			await mkdir(join(root, "other"));
			await writeFile(join(root, "a.ts"), "a");
			await writeFile(join(root, "b.ts"), "b");
			await writeFile(join(root, "c.txt"), "c");
			await writeFile(join(root, "dir", "nested.ts"), "nested");

			const wEntries = [];
			for await (const e of walk(root)) wEntries.push(e);
			const lEntries = await list(root);

			deepStrictEqual(wEntries, lEntries);
		});
	});

	describe(".listFiles()", () => {
		it("should return only file paths", async () => {
			await mkdir(join(root, "dir"));
			await writeFile(join(root, "a.txt"), "a");
			await writeFile(join(root, "b.txt"), "b");

			const files = await listFiles(root);

			deepStrictEqual(files, [join(root, "a.txt"), join(root, "b.txt")]);
		});
	});

	describe(".listDirs()", () => {
		it("should return only directory paths", async () => {
			await mkdir(join(root, "a"));
			await mkdir(join(root, "b"));

			const dirs = await listDirs(root);

			deepStrictEqual(dirs, [join(root, "a"), join(root, "b")]);
		});
	});

	describe(".readDir()", () => {
		it("should return sorted names", async () => {
			await writeFile(join(root, "z.txt"), "");
			await writeFile(join(root, "a.txt"), "");
			await mkdir(join(root, "m"));

			deepStrictEqual(await readDir(root), ["a.txt", "m", "z.txt"]);
		});
	});

	describe(".uniquePath()", () => {
		it("should return the original path when it does not exist", async () => {
			const p = join(root, "file.txt");

			strictEqual(await uniquePath(p), p);
		});

		it("should append a numeric suffix when the path exists", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "");

			strictEqual(await uniquePath(p), join(root, "file (1).txt"));
		});

		it("should skip all existing candidates", async () => {
			const p = join(root, "file.txt");

			await writeFile(p, "");
			await writeFile(join(root, "file (1).txt"), "");
			await writeFile(join(root, "file (2).txt"), "");

			strictEqual(await uniquePath(p), join(root, "file (3).txt"));
		});

		it("should preserve paths without an extension", async () => {
			const p = join(root, "file");
			await writeFile(p, "");

			strictEqual(await uniquePath(p), join(root, "file (1)"));
		});
	});

	describe(".sizeOf()", () => {
		it("should return zero for a missing path", async () => {
			strictEqual(await sizeOf(join(root, "missing")), 0);
		});

		it("should return the size of a file", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "hello");

			strictEqual(await sizeOf(p), 5);
		});

		it("should recursively total file sizes in a directory", async () => {
			const p = join(root, "dir");
			await mkdir(join(p, "nested"), { recursive: true });
			await writeFile(join(p, "one.txt"), "123");
			await writeFile(join(p, "nested", "two.txt"), "4567");

			strictEqual(await sizeOf(p), 7);
		});
	});

	describe("watch()", () => {
		it("should report a newly created file as add", async () => {
			const events: Array<WatchEvent> = [];

			const f = file(root, "file.txt");
			const unsubscribe = await f.watch(event => {
				events.push(event);
			});

			try {
				await f.write("hello", { atomic: false });

				await waitTillEvent(events);
				deepStrictEqual(events, [{ type: "add", path: "file.txt" }]);
			} finally {
				unsubscribe();
			}
		});

		it("should report changes to an existing file", async () => {
			const events: Array<WatchEvent> = [];

			const f = file(root, "file.txt");
			await f.write("before", { atomic: false });

			const unsubscribe = await f.watch(event => events.push(event));

			try {
				await f.write("after", { atomic: false });

				await waitTillEvent(events);
				deepStrictEqual(events, [{ type: "change", path: "file.txt" }]);
			} finally {
				unsubscribe();
			}
		});

		it("should report a remove file", async () => {
			const events: Array<WatchEvent> = [];

			const f = file(root, "file.txt");
			await f.write("before");

			const unsubscribe = await f.watch(event => events.push(event));

			try {
				await f.remove();

				await waitTillEvent(events);
				deepStrictEqual(events, [{ type: "remove", path: "file.txt" }]);
			} finally {
				unsubscribe();
			}
		});

		it("should ignore paths containing ignored segments", async () => {
			const events: Array<WatchEvent> = [];

			const d = dir(root);
			await d.ensure();

			const unsubscribe = await d.watch(event => events.push(event), {
				ignore: ["ignored"],
			});

			try {
				await d.file("ignored", "file.txt").write("asdasd");
				await d.file("a", "file.txt").write("asdasd");

				await waitTillEvent(events);

				ok(!events.some(e => e.path.includes("ignored")));
			} finally {
				unsubscribe();
			}
		});

		// Since waiting for an event to *not* happen is kinda dumb, we're
		// creating 2 watchers, and unsubscribing from only one
		it("should stop reporting events after unsubscribe", async () => {
			const events: Array<WatchEvent> = [];
			const events2: Array<WatchEvent> = [];

			const f = file(root, "file.txt");

			const unsubscribe = await f.watch(event => events.push(event));
			const unsubscribe2 = await f.watch(event => events2.push(event));

			await f.write("hello", { atomic: false });

			await waitTillEvent(events);

			strictEqual(events.length, 1);
			strictEqual(events2.length, 1);

			unsubscribe();
			events2.splice(0, 1);

			await f.write("hello2", { atomic: false });

			await waitTillEvent(events2);
			strictEqual(events.length, 1);

			unsubscribe2();
		});
	});

	describe("EntryRef", () => {
		it("should expose path properties", async () => {
			const p = join(root, "example.test.ts");
			const reference = file(p);

			strictEqual(reference.path, p);
			strictEqual(reference.name, "example.test.ts");
			strictEqual(reference.stem, "example.test");
			strictEqual(reference.ext, ".ts");
			strictEqual(reference.absolute, p);
			strictEqual(reference.posix, p.replaceAll("\\", "/"));
			strictEqual(reference.toString(), p);
		});

		it("should provide parent and relative path operations", async () => {
			const p = join(root, "dir", "file.txt");
			const reference = file(p);

			strictEqual(reference.parent().path, join(root, "dir"));
			strictEqual(reference.relativeTo(root), join("dir", "file.txt"));
			strictEqual(reference.isInside(root), true);
		});

		it("should delegate exists, stat, mtime and size", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "hello");

			const reference = file(p);

			strictEqual(await reference.exists(), true);
			ok(await reference.stat());
			ok(await reference.mtime());
			strictEqual(await reference.size(), 5);
		});
	});

	describe("FileRef", () => {
		it("should delegate read and write operations", async () => {
			const reference = file(root, "file.txt");

			await reference.write("hello");

			strictEqual(await reference.text(), "hello");
			deepStrictEqual(await reference.lines(), ["hello"]);
		});

		it("should support JSON operations", async () => {
			const reference = file(root, "data.json");

			await reference.writeJson({ count: 1 });

			deepStrictEqual(await reference.json(), { count: 1 });

			await reference.updateJson<{
				count: number;
			}>(
				value => ({
					count: value.count + 1,
				}),
				{ count: 0 },
			);

			deepStrictEqual(await reference.json(), { count: 2 });
		});

		it("should expose sibling and extension references", async () => {
			const reference = file(root, "file.txt");

			strictEqual(
				reference.sibling("other.txt").path,
				join(root, "other.txt"),
			);
			strictEqual(
				reference.withExtRef("json").path,
				join(root, "file.json"),
			);
		});

		it("should return a FileRef from copy", async () => {
			const source = file(root, "source.txt");
			const destination = file(root, "destination.txt");

			await source.write("hello");

			const result = await source.copy(destination);

			ok(result instanceof FileRef);
			strictEqual(result.path, destination.path);
			strictEqual(await result.text(), "hello");
		});

		it("should return a FileRef from move", async () => {
			const source = file(root, "source.txt");
			const destination = file(root, "destination.txt");

			await source.write("hello");

			const result = await source.move(destination);

			ok(result instanceof FileRef);
			strictEqual(result.path, destination.path);
			strictEqual(await result.text(), "hello");
		});

		it("should derive rename and extension destinations", async () => {
			const reference = file(root, "old.txt");
			await reference.write("test");

			const renamed = await reference.rename("new.txt");
			ok(renamed instanceof FileRef);
			strictEqual(renamed.path, join(root, "new.txt"));

			const changed = await renamed.withExt("json");
			strictEqual(changed.path, join(root, "new.json"));
		});
	});

	describe("DirRef", () => {
		it("should create child file and directory references", () => {
			const reference = dir(root);

			ok(reference.file("a.txt") instanceof FileRef);
			ok(reference.dir("nested") instanceof DirRef);

			strictEqual(reference.file("a.txt").path, join(root, "a.txt"));
			strictEqual(reference.dir("nested").path, join(root, "nested"));
		});

		it("should list files and directories as refs", async () => {
			await mkdir(join(root, "nested"));
			await writeFile(join(root, "a.txt"), "a");
			await writeFile(join(root, "b.txt"), "b");

			const reference = dir(root);

			const files = await reference.files();
			const dirs = await reference.dirs();

			ok(files.every(f => f instanceof FileRef));
			ok(dirs.every(d => d instanceof DirRef));

			deepStrictEqual(
				files.map(f => f.path),
				[join(root, "a.txt"), join(root, "b.txt")],
			);

			deepStrictEqual(
				dirs.map(d => d.path),
				[join(root, "nested")],
			);
		});

		it("should expose names", async () => {
			await writeFile(join(root, "z.txt"), "");
			await writeFile(join(root, "a.txt"), "");

			deepStrictEqual(await dir(root).names(), ["a.txt", "z.txt"]);
		});

		it("should return a DirRef from copy", async () => {
			const source = dir(root, "source");
			const destination = dir(root, "destination");

			await source.ensure();
			await source.file("file.txt").write("hello");

			const result = await source.copy(destination);

			ok(result instanceof DirRef);
			strictEqual(await result.file("file.txt").text(), "hello");
		});

		it("should return a DirRef from move", async () => {
			const source = dir(root, "source");
			const destination = dir(root, "destination");

			await source.ensure();
			await source.file("file.txt").write("hello");

			const result = await source.move(destination);

			ok(result instanceof DirRef);
			strictEqual(await result.file("file.txt").text(), "hello");
		});
	});

	describe(".ref()", () => {
		it("should return null for a missing path", async () => {
			strictEqual(await ref(join(root, "missing")), null);
		});

		it("should return a FileRef for a file", async () => {
			const p = join(root, "file.txt");
			await writeFile(p, "hello");

			const result = await ref(p);

			ok(result instanceof FileRef);
			strictEqual(result.path, p);
		});

		it("should return a DirRef for a directory", async () => {
			const p = join(root, "dir");
			await mkdir(p);

			const result = await ref(p);

			ok(result instanceof DirRef);
			strictEqual(result.path, p);
		});
	});
});
