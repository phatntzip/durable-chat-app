import { DurableObject } from "cloudflare:workers";
import {
	type Connection,
	Server,
	type WSMessage,
	routePartykitRequest,
} from "partyserver";

import type { ChatMessage, Message, RoomInfo } from "../shared";

// keeps track of every chat room and how many users are connected to it,
// because Durable Objects can't be enumerated from the outside
export class Registry extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, users INTEGER NOT NULL, last_active INTEGER NOT NULL)`,
		);
	}

	report(room: string, users: number) {
		this.ctx.storage.sql.exec(
			`INSERT INTO rooms (id, users, last_active) VALUES (?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET users = ?, last_active = ?`,
			room,
			users,
			Date.now(),
			users,
			Date.now(),
		);
	}

	list() {
		return this.ctx.storage.sql
			.exec(
				`SELECT id, users, last_active AS lastActive FROM rooms
				 ORDER BY users DESC, last_active DESC LIMIT 100`,
			)
			.toArray() as RoomInfo[];
	}
}

export class Chat extends Server<Env> {
	static options = { hibernate: true };

	messages = [] as ChatMessage[];

	broadcastMessage(message: Message, exclude?: string[]) {
		this.broadcast(JSON.stringify(message), exclude);
	}

	onStart() {
		// this is where you can initialize things that need to be done before the server starts
		// for example, load previous messages from a database or a service

		// create the messages table if it doesn't exist
		this.ctx.storage.sql.exec(
			`CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user TEXT, role TEXT, content TEXT)`,
		);

		// load the messages from the database
		this.messages = this.ctx.storage.sql
			.exec(`SELECT * FROM messages`)
			.toArray() as ChatMessage[];
	}

	async reportUsers(excluding?: string) {
		const users = [...this.getConnections()].filter(
			(c) => c.id !== excluding,
		).length;
		try {
			await this.env.Registry.getByName("global").report(this.name, users);
		} catch (e) {
			// the room list is best-effort, never break the chat because of it
			console.error("failed to report room to registry", e);
		}
	}

	async onConnect(connection: Connection) {
		connection.send(
			JSON.stringify({
				type: "all",
				messages: this.messages,
			} satisfies Message),
		);
		await this.reportUsers();
	}

	async onClose(connection: Connection) {
		await this.reportUsers(connection.id);
	}

	saveMessage(message: ChatMessage) {
		// check if the message already exists
		const existingMessage = this.messages.find((m) => m.id === message.id);
		if (existingMessage) {
			this.messages = this.messages.map((m) => {
				if (m.id === message.id) {
					return message;
				}
				return m;
			});
		} else {
			this.messages.push(message);
		}

		// Use parameterized queries to prevent SQL injection
		this.ctx.storage.sql.exec(
			`INSERT INTO messages (id, user, role, content) VALUES (?, ?, ?, ?)
			 ON CONFLICT (id) DO UPDATE SET content = ?`,
			message.id,
			message.user,
			message.role,
			message.content,
			message.content,
		);
	}

	onMessage(connection: Connection, message: WSMessage) {
		// let's broadcast the raw message to everyone else
		this.broadcast(message);

		// let's update our local messages store
		const parsed = JSON.parse(message as string) as Message;
		if (parsed.type === "add" || parsed.type === "update") {
			this.saveMessage(parsed);
		}
	}
}

export default {
	async fetch(request, env) {
		if (new URL(request.url).pathname === "/api/rooms") {
			return Response.json(await env.Registry.getByName("global").list());
		}
		return (
			(await routePartykitRequest(request, { ...env })) ||
			env.ASSETS.fetch(request)
		);
	},
} satisfies ExportedHandler<Env>;
