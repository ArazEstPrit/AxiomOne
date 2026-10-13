import type { FileSystemOperation } from "./types.ts";

export class FileSystemError extends Error {
	readonly operation: FileSystemOperation;
	readonly path: string;
	readonly code?: string;

	constructor(
		message: string,
		path: string,
		operation: FileSystemOperation,
		cause?: unknown,
		code?: string,
	) {
		super(message, { cause });
		this.name = "FileSystemError";
		this.path = path;
		this.operation = operation;
		if (code) this.code = code;
	}
}

export class FileNotFoundError extends FileSystemError {
	constructor(
		path: string,
		operation: FileSystemOperation = "read",
		cause?: unknown,
	) {
		super(
			`File or directory not found: "${path}"`,
			path,
			operation,
			cause,
			"ENOENT",
		);
		this.name = "FileNotFoundError";
	}
}

export class PathNotFoundError extends FileNotFoundError {
	constructor(
		path: string,
		operation: FileSystemOperation = "read",
		cause?: unknown,
	) {
		super(path, operation, cause);
		this.message = `Path not found: "${path}"`;
		this.name = "PathNotFoundError";
	}
}

export class FileAlreadyExistsError extends FileSystemError {
	constructor(
		path: string,
		operation: FileSystemOperation = "write",
		cause?: unknown,
	) {
		super(
			`File or directory already exists: "${path}"`,
			path,
			operation,
			cause,
			"EEXIST",
		);
		this.name = "FileAlreadyExistsError";
	}
}

export class FileSystemPermissionError extends FileSystemError {
	constructor(path: string, operation: FileSystemOperation, cause?: unknown) {
		super(
			`Permission denied while trying to ${operation} "${path}"`,
			path,
			operation,
			cause,
			"EACCES",
		);
		this.name = "FileSystemPermissionError";
	}
}

export class FileSystemOperationError extends FileSystemError {
	constructor(path: string, operation: FileSystemOperation, cause?: unknown) {
		super(`Failed to ${operation} "${path}"`, path, operation, cause);
		this.name = "FileSystemOperationError";
	}
}
