import { existsSync, renameSync, rmSync } from "fs";

/**
 * Backup a directory by renaming it to `${path}-temp`.
 * If a backup already exists, it will be deleted first.
 */
export function backupDir(path: string): void {
	const backupPath = path + "-temp";

	if (existsSync(backupPath)) rmSync(backupPath, { recursive: true });
	if (existsSync(path)) renameSync(path, backupPath);
}

/**
 * Restore a previously backed-up directory.
 * If the original exists, it will be deleted before restoring.
 */
export function restoreDir(path: string): void {
	const backupPath = path + "-temp";

	if (!existsSync(backupPath)) return;

	if (existsSync(path)) rmSync(path, { recursive: true });
	renameSync(backupPath, path);
}
