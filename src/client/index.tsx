import { createRoot } from "react-dom/client";
import { usePartySocket } from "partysocket/react";
import React, { useEffect, useState } from "react";
import {
	BrowserRouter,
	Routes,
	Route,
	Link,
	Navigate,
	useParams,
} from "react-router";
import { nanoid } from "nanoid";

import {
	names,
	type ChatMessage,
	type Message,
	type RoomInfo,
} from "../shared";

function RoomList({ current }: { current?: string }) {
	const [rooms, setRooms] = useState<RoomInfo[]>([]);

	useEffect(() => {
		let cancelled = false;
		const load = async () => {
			try {
				const res = await fetch("/api/rooms");
				if (res.ok && !cancelled) setRooms(await res.json());
			} catch {
				// keep showing the last known list
			}
		};
		load();
		const timer = setInterval(load, 5000);
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	}, []);

	return (
		<div className="row room-list">
			<p>All rooms ({rooms.length})</p>
			<ul>
				{rooms.map((room) => (
					<li key={room.id} className={room.id === current ? "current" : ""}>
						<Link to={`/${room.id}`}>{room.id}</Link>{" "}
						<span className="room-users">
							{room.users > 0
								? `${room.users} online`
								: `idle, last active ${new Date(room.lastActive).toLocaleString()}`}
						</span>
					</li>
				))}
			</ul>
		</div>
	);
}

function App() {
	const [name] = useState(names[Math.floor(Math.random() * names.length)]);
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const { room } = useParams();
	const [copied, setCopied] = useState(false);
	const shareLink = window.location.href;

	// switching rooms: drop the previous room's messages until the new history arrives
	useEffect(() => setMessages([]), [room]);

	const socket = usePartySocket({
		party: "chat",
		room,
		onMessage: (evt) => {
			const message = JSON.parse(evt.data as string) as Message;
			if (message.type === "add") {
				const foundIndex = messages.findIndex((m) => m.id === message.id);
				if (foundIndex === -1) {
					// probably someone else who added a message
					setMessages((messages) => [
						...messages,
						{
							id: message.id,
							content: message.content,
							user: message.user,
							role: message.role,
						},
					]);
				} else {
					// this usually means we ourselves added a message
					// and it was broadcasted back
					// so let's replace the message with the new message
					setMessages((messages) => {
						return messages
							.slice(0, foundIndex)
							.concat({
								id: message.id,
								content: message.content,
								user: message.user,
								role: message.role,
							})
							.concat(messages.slice(foundIndex + 1));
					});
				}
			} else if (message.type === "update") {
				setMessages((messages) =>
					messages.map((m) =>
						m.id === message.id
							? {
									id: message.id,
									content: message.content,
									user: message.user,
									role: message.role,
								}
							: m,
					),
				);
			} else {
				setMessages(message.messages);
			}
		},
	});

	return (
		<div className="chat container">
			<RoomList current={room} />
			{messages.map((message) => (
				<div key={message.id} className="row message">
					<div className="two columns user">{message.user}</div>
					<div className="ten columns">{message.content}</div>
				</div>
			))}
			<div className="row your-name">
				You are chatting as <strong>{name}</strong>
			</div>
			<div className="row share-link">
				<p>You can send this link to anyone whom you want to chat:</p>
				<div className="row">
					<input
						type="text"
						className="ten columns share-link-input"
						value={shareLink}
						readOnly
						onFocus={(e) => e.currentTarget.select()}
					/>
					<button
						type="button"
						className="two columns copy-link"
						onClick={async () => {
							await navigator.clipboard.writeText(shareLink);
							setCopied(true);
							setTimeout(() => setCopied(false), 2000);
						}}
					>
						{copied ? "Copied!" : "Copy"}
					</button>
				</div>
			</div>
			<form
				className="row"
				onSubmit={(e) => {
					e.preventDefault();
					const content = e.currentTarget.elements.namedItem(
						"content",
					) as HTMLInputElement;
					const chatMessage: ChatMessage = {
						id: nanoid(8),
						content: content.value,
						user: name,
						role: "user",
					};
					setMessages((messages) => [...messages, chatMessage]);
					// we could broadcast the message here

					socket.send(
						JSON.stringify({
							type: "add",
							...chatMessage,
						} satisfies Message),
					);

					content.value = "";
				}}
			>
				<input
					type="text"
					name="content"
					className="ten columns my-input-text"
					placeholder={`Hello ${name}! Type a message...`}
					autoComplete="off"
				/>
				<button type="submit" className="send-message two columns">
					Send
				</button>
			</form>
		</div>
	);
}

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
createRoot(document.getElementById("root")!).render(
	<BrowserRouter>
		<Routes>
			<Route path="/" element={<Navigate to={`/${nanoid()}`} />} />
			<Route path="/:room" element={<App />} />
			<Route path="*" element={<Navigate to="/" />} />
		</Routes>
	</BrowserRouter>,
);
