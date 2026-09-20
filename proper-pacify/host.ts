import { AsyncLocalStorage } from "node:async_hooks";
import {
	AgentSession,
	type ExtensionContext,
	type InputEvent,
	type InputEventResult,
	InteractiveMode,
	type MarkdownTransformer,
	type SessionManager,
	UserMessageComponent,
} from "@earendil-works/pi-coding-agent";

type Message = Parameters<SessionManager["appendMessage"]>[0];
export type RewriteOrigin = { entryId: string; before: string };
export type InputDecision = {
	result: InputEventResult;
	origin?: RewriteOrigin;
};

export interface PacifyHostHooks {
	active: boolean;
	manager: ExtensionContext["sessionManager"] | undefined;
	transformer: MarkdownTransformer;
	displayRevision: number;
	prepare(
		ctx: ExtensionContext,
		event: Pick<InputEvent, "text" | "images" | "source">,
	): Promise<InputDecision>;
	bind(message: Message, origin: RewriteOrigin): void;
	persist(message: Message, entryId: string, manager: SessionManager): void;
	transform(message: Message, ...args: Parameters<MarkdownTransformer>): string;
}

// Pi 0.85.1 has neither a pre-command input hook nor message identity in its
// Markdown context. Keep the host adapter here; remove it when those APIs exist.
// @lat: [[proper-pacify#Dispatch priority]]
export function installHostHooks(hooks: PacifyHostHooks): {
	inDispatch(): boolean;
	dispose(): void;
} {
	const dispatch = new AsyncLocalStorage<{
		origin: RewriteOrigin | undefined;
		bound: boolean;
	}>();
	const restorers: Array<() => void> = [];
	const boundAgents = new WeakSet<AgentSession["agent"]>();
	const boundManagers = new WeakSet<SessionManager>();

	function bindSession(session: AgentSession): void {
		const agent = session.agent;
		if (!boundAgents.has(agent)) {
			boundAgents.add(agent);
			// These public Agent entry points see the actual message objects after
			// all transformations/expansion, including queued steering/follow-ups.
			for (const name of ["prompt", "steer", "followUp"] as const) {
				const original = agent[name];
				const wrapped = function (this: typeof agent, ...args: unknown[]) {
					const scope = dispatch.getStore();
					if (hooks.active && scope?.origin && !scope.bound) {
						const messages = Array.isArray(args[0]) ? args[0] : [args[0]];
						const message = messages.find((value) => value?.role === "user");
						if (message) {
							hooks.bind(message, scope.origin);
							scope.bound = true;
						}
					}
					return Reflect.apply(original, this, args);
				};
				Reflect.set(agent, name, wrapped);
				restorers.push(() => {
					if (agent[name] === wrapped) Reflect.set(agent, name, original);
				});
			}
		}
		const manager = session.sessionManager;
		if (!boundManagers.has(manager)) {
			boundManagers.add(manager);
			const append = manager.appendMessage;
			const wrapped: typeof append = function (this: SessionManager, message) {
				const id = append.call(this, message);
				if (hooks.active) hooks.persist(message, id, this);
				return id;
			};
			manager.appendMessage = wrapped;
			restorers.push(() => {
				if (manager.appendMessage === wrapped) manager.appendMessage = append;
			});
		}
	}

	const prompt = AgentSession.prototype.prompt;
	const wrappedPrompt: typeof prompt = async function (
		this: AgentSession,
		text,
		options,
	) {
		if (!hooks.active || this.sessionManager !== hooks.manager) {
			return prompt.call(this, text, options);
		}
		bindSession(this);
		let decision: InputDecision;
		try {
			decision = await hooks.prepare(this.extensionRunner.createContext(), {
				text,
				source: options?.source ?? "interactive",
				...(options?.images ? { images: options.images } : {}),
			});
		} catch (error) {
			options?.preflightResult?.(false);
			throw error;
		}
		if (!hooks.active || decision.result.action === "handled") {
			options?.preflightResult?.(true);
			return;
		}
		const result = decision.result;
		return dispatch.run({ origin: decision.origin, bound: false }, () =>
			prompt.call(
				this,
				result.action === "transform" ? result.text : text,
				result.action === "transform" && result.images
					? { ...options, images: result.images }
					: options,
			),
		);
	};
	AgentSession.prototype.prompt = wrappedPrompt;
	restorers.push(() => {
		if (AgentSession.prototype.prompt === wrappedPrompt)
			AgentSession.prototype.prompt = prompt;
	});

	// Capture identity at component construction, not by text during rendering.
	// The host still builds and renders its own user components and transformers.
	type InteractiveHost = {
		session: AgentSession;
		chatContainer: { children: unknown[] };
		getMarkdownTransformers(): MarkdownTransformer[];
		addMessageToChat(message: Message, options?: unknown): void;
	};
	const prototype = InteractiveMode.prototype as unknown as InteractiveHost;
	const addMessage = prototype.addMessageToChat;
	const wrappedAdd: typeof addMessage = function (
		this: InteractiveHost,
		message,
		options,
	) {
		if (!hooks.active || message.role !== "user") {
			return addMessage.call(this, message, options);
		}
		const get = this.getMarkdownTransformers;
		// Reload rebuilds chat before session_start assigns the manager. The
		// runner's marker identifies ownership even during that pre-start phase.
		if (!get.call(this).includes(hooks.transformer))
			return addMessage.call(this, message, options);
		const own = Object.hasOwn(this, "getMarkdownTransformers");
		const getForMessage = () =>
			get
				.call(this)
				.map((transformer) =>
					transformer === hooks.transformer
						? (...args: Parameters<MarkdownTransformer>) =>
								hooks.active ? hooks.transform(message, ...args) : args[0]
						: transformer,
				);
		const start = this.chatContainer.children.length;
		this.getMarkdownTransformers = getForMessage;
		try {
			addMessage.call(this, message, options);
		} finally {
			if (this.getMarkdownTransformers === getForMessage) {
				if (own) this.getMarkdownTransformers = get;
				else Reflect.deleteProperty(this, "getMarkdownTransformers");
			}
		}
		for (const component of this.chatContainer.children.slice(start)) {
			if (!(component instanceof UserMessageComponent)) continue;
			const render = component.render;
			let revision = hooks.displayRevision;
			component.render = (width) => {
				if (revision !== hooks.displayRevision) {
					revision = hooks.displayRevision;
					component.invalidate();
				}
				return render.call(component, width);
			};
		}
	};
	prototype.addMessageToChat = wrappedAdd;
	restorers.push(() => {
		if (prototype.addMessageToChat === wrappedAdd)
			prototype.addMessageToChat = addMessage;
	});

	return {
		inDispatch: () => dispatch.getStore() !== undefined,
		dispose() {
			hooks.active = false;
			hooks.displayRevision++;
			for (const restore of restorers.reverse()) restore();
			dispatch.disable();
		},
	};
}
