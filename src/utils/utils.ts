export function arrMax<T>(arr: T[], map: (a: T) => number): T | null {
	let val = null;
	let max = Number.NEGATIVE_INFINITY;

	for (const a of arr) {
		if (map(a) > max) {
			max = map(a);
			val = a;
		}
	}

	return val!;
}

export function mapIncrement(map: Map<unknown, number>, key: unknown) {
	map.set(key, (map.get(key) || 0) + 1);
}

export function mapPush(
	map: Map<unknown, unknown[]>,
	key: unknown,
	item: unknown,
) {
	map.set(key, (map.get(key) || []).concat(item));
}

export function fac(n: number): number {
	return n == 0 ? 1 : n * fac(n - 1);
}

export function nCr(n: number, r: number) {
	return fac(n) / (fac(r) * fac(n - r));
}

export async function runWithTimeout(
	fn: () => Promise<unknown>,
	timeout: number,
	rejection: unknown,
): Promise<void> {
	let timeoutId: NodeJS.Timeout;
	(await Promise.race([
		fn(),
		new Promise(
			(_, rej) =>
				(timeoutId = setTimeout(() => {
					rej(rejection);
				}, timeout)),
		),
	]).finally(() => {
		clearTimeout(timeoutId);
	})) as Promise<void>;
}

export function deepFreeze<T>(obj: T): Readonly<T> {
	if (obj === null || typeof obj !== "object") {
		return obj;
	}

	Object.keys(obj).forEach(key => {
		deepFreeze((obj as Record<string, unknown>)[key]);
	});

	return Object.freeze(obj);
}

export function isObject(obj: unknown): obj is object {
	return typeof obj === "object" && !Array.isArray(obj) && obj !== null;
}

export function trycatch<T, U>(
	tryFn: () => T,
	catchFn: (err: unknown) => U = err => err as U,
): T | U {
	try {
		return tryFn();
	} catch (error) {
		return catchFn(error);
	}
}
