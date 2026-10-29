/**
 * Central AI Agent (مغز سیستم) — types.
 *
 * A tool-calling agent that runs on the user's own Cloudflare AI workers.
 * The agent sees a TOOL REGISTRY (dynamically built from the live database),
 * answers questions, performs actions, asks when unsure, and renders its
 * answers as rich markdown in the chat UI.
 */

import type { ContentPart } from "../ai/client";

/* ------------------------------ Tool registry ----------------------------- */

/** JSON-schema-ish parameter description (kept deliberately simple). */
export interface ToolParam {
  /** Parameter name as the model writes it (snake_case). */
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description: string;
  required?: boolean;
  /** Enum of allowed values (e.g. currency codes). */
  enum?: string[];
  /** When type is array — the item type. */
  items?: { type: "string" | "number" };
}

export interface ToolDef {
  /** snake_case id the model calls: "list_customers". */
  name: string;
  /** One-line Persian description shown to the model. */
  description: string;
  params: ToolParam[];
  /** Reads data (safe) vs writes (mutates). Shown in the UI chip. */
  writes: boolean;
}

/** A parsed tool call from the model. */
export interface ToolCallRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Result of executing one tool call. */
export interface ToolCallResult {
  id: string;
  name: string;
  ok: boolean;
  /** Compact JSON value for the model. */
  data: unknown;
  /** Human-readable summary for the chat UI (Persian). */
  summary?: string;
  ms: number;
  /** The tool returned an image the model should see (view_document). */
  image?: string;
}

/* -------------------------------- Messages -------------------------------- */

export interface AgentAttachment {
  /** Stable id inside the conversation ("f1", "f2"…). */
  id: string;
  name: string;
  /** Small thumbnail data URL for the chat bubble. */
  thumb: string;
  /** Full JPEG data URL sent to the model. */
  full: string;
}

/** One executed tool call, kept for the chat transcript. */
export interface AgentToolStep {
  call: ToolCallRequest;
  result: ToolCallResult;
}

export interface AgentMessage {
  role: "user" | "assistant";
  text: string;
  ts: number;
  /** Files the user attached to this message. */
  files?: AgentAttachment[];
  /** Tool calls executed while producing this assistant message. */
  steps?: AgentToolStep[];
  /** Worker label that produced the final answer (multi-account trace). */
  worker?: string;
  /** Set when the run ended with an error. */
  error?: string;
}

/* ------------------------------- Chat records ------------------------------ */

/** A saved conversation (persisted in IndexedDB, table aiChats). */
export interface AgentChatRecord {
  id: string;
  title: string;
  messages: AgentMessage[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------ Agent runtime ------------------------------ */

export interface AgentRunEvents {
  /** The model asked for tool calls — executing them. */
  onToolCalls?: (calls: ToolCallRequest[]) => void;
  /** One tool finished. */
  onToolResult?: (result: ToolCallResult) => void;
  /** Progress text for the UI ("در حال فکر کردن…", "حساب ۲…"). */
  onStatus?: (label: string) => void;
  /** The agent produced its final text answer. */
  onFinal?: (text: string, worker: string) => void;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  /** Max tool-call rounds before forcing a final answer. Default 8. */
  maxRounds?: number;
}

/** Turn input: the visible history + the new user message (with files). */
export interface AgentTurnInput {
  /** Prior messages (compact — tool results are summarized). */
  history: AgentMessage[];
  text: string;
  files: AgentAttachment[];
}

export type AgentTurnResult =
  | { kind: "answer"; text: string; worker: string; steps: AgentToolStep[] }
  | { kind: "aborted" }
  | { kind: "error"; message: string; steps: AgentToolStep[] };

/** Internal: content parts for one model request. */
export type ModelContent = string | ContentPart[];
