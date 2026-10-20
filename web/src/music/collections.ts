/** Element at `index`, failing loudly instead of yielding `undefined`. */
export function at<T>(items: ArrayLike<T>, index: number): T {
	const item = items[index];
	if (item === undefined) throw new RangeError(`index ${index} out of range (length ${items.length})`);
	return item;
}

/** A record with exactly the given keys, each value computed from its key. */
export function recordOf<K extends string, V>(keys: readonly K[], value: (key: K) => V): Record<K, V> {
	return Object.fromEntries(keys.map((k) => [k, value(k)])) as Record<K, V>;
}
