// This small protocol is shipped in both independent packages. The root
// integration test requires identical copies; neither package depends on the other.
export const ORIGINAL_INPUT = Symbol.for("proper-pi.original-input.v1");
const WRAPPER = Symbol.for("proper-pi.method-wrapper.v1");
type WrapperState = {
	original: unknown;
	descriptor: PropertyDescriptor | undefined;
	active: boolean;
};

export function originalInput(
	text: string,
	options: object | undefined,
): string {
	const value = options && Reflect.get(options, ORIGINAL_INPUT);
	return typeof value === "string" ? value : text;
}

/** Owners deactivate their callbacks before disposal. Unlink inactive peers
 * even when shutdown runs in installation order rather than stack order.
 */
export function installWrapper(
	target: object,
	key: PropertyKey,
	wrapped: object,
): () => void {
	const state: WrapperState = {
		original: Reflect.get(target, key),
		descriptor: Object.getOwnPropertyDescriptor(target, key),
		active: true,
	};
	Reflect.set(wrapped, WRAPPER, state);
	Reflect.set(target, key, wrapped);
	return () => {
		state.active = false;
		if (Reflect.get(target, key) !== wrapped) return;
		let previous = state;
		while (typeof previous.original === "function") {
			const prior = Reflect.get(previous.original, WRAPPER) as
				| WrapperState
				| undefined;
			if (!prior || prior.active) break;
			previous = prior;
		}
		if (previous.descriptor)
			Object.defineProperty(target, key, previous.descriptor);
		else Reflect.deleteProperty(target, key);
	};
}
