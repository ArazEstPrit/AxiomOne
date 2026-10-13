export type EntryType = "file" | "dir" | "symlink" | "other";

export interface Entry {
	path: string;
	name: string;
	type: EntryType;
}

export interface WalkOptions {
	recursive?: boolean;
	maxDepth?: number;
	hidden?: boolean;
	ignore?: string[];
	type?: "file" | "dir";
	exts?: string[];
	filter?: (e: Entry) => boolean;
}

export interface WriteOptions {
	atomic?: boolean;
	mkdirs?: boolean;
	encoding?: BufferEncoding;
}

export type WatchEventType = "add" | "change" | "remove" | "rename";

interface BaseWatchEvent<T extends WatchEventType> {
	type: T;
	/** Relative from watch root */
	path: string;
}

interface AddWatchEvent extends BaseWatchEvent<"add"> {}
interface ChangeWatchEvent extends BaseWatchEvent<"change"> {}
interface DeleteWatchEvent extends BaseWatchEvent<"remove"> {}
interface RenameWatchEvent extends BaseWatchEvent<"rename"> {
	from: string;
}

export type WatchEvent =
	AddWatchEvent | ChangeWatchEvent | DeleteWatchEvent | RenameWatchEvent;

export interface WatchOptions {
	recursive?: boolean;
	ignore?: string[];
}

export type WatchUnsubscribe = () => void;

export type FileSystemOperation =
	| "stat"
	| "read"
	| "write"
	| "append"
	| "mkdir"
	| "remove"
	| "copy"
	| "move"
	| "watch";
