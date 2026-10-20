/** The element with this id, checked to be of the expected type. */
export function element<T extends HTMLElement>(id: string, type: new () => T): T {
	const found = document.getElementById(id);
	if (!(found instanceof type)) throw new Error(`#${id} missing or not a ${type.name}`);
	return found;
}

export function option(value: string, text: string): HTMLOptionElement {
	const created = document.createElement("option");
	created.value = value;
	created.textContent = text;
	return created;
}

export function button(text: string, onClick: () => void): HTMLButtonElement {
	const created = document.createElement("button");
	created.type = "button";
	created.textContent = text;
	created.addEventListener("click", onClick);
	return created;
}
