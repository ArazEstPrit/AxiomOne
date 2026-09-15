import { LogEntry, LogId, LogMap } from "./types.ts";

export function log<T extends LogId>(
	severity: number,
	id: T,
	message: string,
	data: LogMap[T],
): void;
export function log(
	severity: number,
	message: string,
	data?: Record<string, unknown>,
): void;
export function log(
	severity: number,
	idOrMessage: string,
	messageOrData: string | unknown,
	d: unknown,
) {}

export function sink(fn: (log: LogEntry) => void) {}
