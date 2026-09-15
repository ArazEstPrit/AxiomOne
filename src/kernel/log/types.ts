export interface LogMap {
	base: Record<string, unknown> | undefined;
}

export type LogId = keyof LogMap;

interface BaseLogEntry {
	id: string;
	severity: number;
	message: string;
	scopeId: string | null;
	timestamp: number;
	seq: number;
	source: string;
}

interface TypedLogEntry<T extends LogId> extends BaseLogEntry {
	logId: T;
	data: LogMap[T];
}

interface GenericLogEntry extends BaseLogEntry {
	logId?: "base";
	data?: LogMap["base"];
}

export type LogEntry<T extends LogId = LogId> = {
	[K in LogId]: K extends "base" ? GenericLogEntry : TypedLogEntry<K>;
}[T];
