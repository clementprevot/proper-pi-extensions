import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import properBase from "../index.ts";

// Focused editor/history tests own only the first (base) lifecycle handlers.
// auto-update-startup.test.ts exercises both owners with a full dispatcher.
export default function baseOnly(api: ExtensionAPI): void {
	const seen = new Set<string>();
	properBase({
		...api,
		registerFlag() {},
		getFlag: () => false,
		on: ((event: string, handler: unknown) => {
			if (event === "session_start" || event === "session_shutdown") {
				if (seen.has(event)) return;
				seen.add(event);
			}
			Reflect.apply(api.on, api, [event, handler]);
		}) as ExtensionAPI["on"],
	});
}
