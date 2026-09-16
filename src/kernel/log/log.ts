import { randomUUID } from "crypto";
import type { LogEntry, LogId, LogMap, LogSink } from "./types.ts";
import { currentScope } from "#kernel/scope";

const sinks = [] as LogSink[];
let seq = 0;
const nextSeq = () => seq++;

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
	messageOrData?: string | unknown,
	d?: unknown,
) {
	const logId = d ? idOrMessage : "base",
		message = d ? messageOrData : idOrMessage,
		data = d ? d : messageOrData;

	emit({
		id: randomUUID(),
		severity,
		message,
		scopeId: currentScope()?.id || null,
		timestamp: Date.now(),
		seq: nextSeq(),
		source: "", // TODO
		logId,
		data,
	} as LogEntry);
}

export function sink(fn: LogSink) {
	sinks.push(fn);
}

function emit(log: LogEntry) {
	for (const fn of sinks) fn(log);
}
