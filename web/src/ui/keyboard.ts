/** Keyboard shortcuts: a table from key to command, so every shortcut is listed in one place. */
export type Keymap = ReadonlyMap<string, () => void>;

export function bindKeyboard(keymap: Keymap): void {
	document.addEventListener("keydown", (event) => {
		const isTyping = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
		if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;
		const command = keymap.get(event.key.toLowerCase()) ?? keymap.get(event.code);
		if (command === undefined) return;
		event.preventDefault();
		command();
	});
}
