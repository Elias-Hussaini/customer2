/**
 * Chat CRUD for the AI assistant (دستیار هوشمند) on the `aiChats` table.
 * Conversations are local-only (like AI worker keys) — nothing leaves the
 * device except what the user explicitly sends to their own workers.
 */

import { db } from "../../db/schema";
import type { AgentChatRecord, AgentMessage } from "./types";
import { uid } from "../../utils/id";

export async function listChats(): Promise<AgentChatRecord[]> {
  const all = await db.aiChats.toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getChat(id: string): Promise<AgentChatRecord | undefined> {
  return db.aiChats.get(id);
}

/** Derive a short title from the first user message. */
export function titleFromMessage(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= 38 ? t || "گفتگوی جدید" : `${t.slice(0, 38)}…`;
}

export async function createChat(firstMessage: AgentMessage): Promise<AgentChatRecord> {
  const now = Date.now();
  const rec: AgentChatRecord = {
    id: uid(),
    title: titleFromMessage(firstMessage.text),
    messages: [firstMessage],
    createdAt: now,
    updatedAt: now,
  };
  await db.aiChats.add(rec);
  return rec;
}

export async function appendMessages(
  chatId: string,
  messages: AgentMessage[],
  patch?: { title?: string },
): Promise<void> {
  const chat = await db.aiChats.get(chatId);
  if (!chat) return;
  await db.aiChats.put({
    ...chat,
    title: patch?.title ?? chat.title,
    messages: [...chat.messages, ...messages],
    updatedAt: Date.now(),
  });
}

export async function updateChatTitle(id: string, title: string): Promise<void> {
  const chat = await db.aiChats.get(id);
  if (!chat) return;
  await db.aiChats.put({ ...chat, title: title.trim() || chat.title, updatedAt: Date.now() });
}

export async function deleteChat(id: string): Promise<void> {
  await db.aiChats.delete(id);
}
