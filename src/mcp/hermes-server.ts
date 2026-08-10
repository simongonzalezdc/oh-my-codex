/**
 * OMX Hermes Coordination MCP Server
 * Small product-facing bridge for dispatch/status/artifact coordination.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { autoStartStdioMcpServer } from "./bootstrap.js";
import {
  hermesListArtifacts,
  hermesListQuestionEvents,
  hermesListQuestions,
  hermesListSessions,
  hermesReadArtifact,
  hermesReadStatus,
  hermesReadTail,
  hermesReportStatus,
  hermesSendPrompt,
  hermesSubmitQuestionAnswer,
  hermesStartSession,
} from "./hermes-bridge.js";

const server = new Server(
  { name: "omx-hermes", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

export function buildHermesServerTools() {
  const workingDirectory = { type: "string", description: "Bounded OMX project/worktree directory" };
  const sessionId = { type: "string", description: "OMX session_id (A-Z, a-z, 0-9, _, -)" };
  const allowMutation = {
    type: "boolean",
    description: "Must be true for mutating operations; read tools ignore it.",
  };
  return [
    {
      name: "hermes_list_sessions",
      description: "List known OMX session state for a bounded worktree without reading terminal UI. Returns an array of session objects with IDs and mode status. Use when discovering active OMX sessions from a coordinator. Pass workingDirectory from the project root.",
      inputSchema: { type: "object", properties: { workingDirectory } },
    },
    {
      name: "hermes_start_session",
      description: "Start a new isolated OMX tmux session in disposable worktree mode for one bounded prompt. Returns a session-start result with the new session ID. Use when launching a detached agent worker for a specific task. Pass workingDirectory from the project root, prompt from the task description, and allow_mutation=true for write operations.",
      inputSchema: {
        type: "object",
        properties: {
          workingDirectory,
          prompt: { type: "string" },
          worktreeName: { type: "string" },
          allow_mutation: allowMutation,
        },
        required: ["workingDirectory", "prompt", "allow_mutation"],
      },
    },
    {
      name: "hermes_send_prompt",
      description: "Queue one explicit prompt for a selected OMX exec session via the audited follow-up queue. Returns a queue-acceptance confirmation. Use when sending a follow-up instruction to a running session. Pass session_id from hermes_list_sessions, prompt from the instruction, and allow_mutation=true for write operations.",
      inputSchema: {
        type: "object",
        properties: {
          workingDirectory,
          session_id: sessionId,
          prompt: { type: "string" },
          actor: { type: "string" },
          allow_mutation: allowMutation,
        },
        required: ["session_id", "prompt", "allow_mutation"],
      },
    },
    {
      name: "hermes_read_status",
      description: "Read selected session or mode status JSON from OMX state files. Returns the session status object with active flag, phase, and progress. Use when checking a session current state without touching the terminal. Pass session_id from hermes_list_sessions.",
      inputSchema: { type: "object", properties: { workingDirectory, session_id: sessionId } },
    },
    {
      name: "hermes_read_tail",
      description: "Read the bounded OMX session history log tail from structured log files, not tmux scrollback. Returns recent log entries with timestamps. Use when inspecting recent session output without terminal access. Pass workingDirectory from the project root and optionally lines to limit entries.",
      inputSchema: { type: "object", properties: { workingDirectory, lines: { type: "number" } } },
    },
    {
      name: "hermes_list_question_events",
      description: "Read structured question lifecycle events for coordinator bridge correlation. Returns an array of question-event objects with question IDs and lifecycle transitions. Use when tracking open questions across sessions. Pass workingDirectory from the project root and optionally limit to cap entries.",
      inputSchema: { type: "object", properties: { workingDirectory, limit: { type: "number" } } },
    },
    {
      name: "hermes_list_questions",
      description: "List bounded structured question records without reading terminal UI. Returns an array of question objects with IDs, status, and prompt text. Use when discovering pending questions that need answers. Pass session_id from hermes_list_sessions and optionally status to filter.",
      inputSchema: {
        type: "object",
        properties: {
          workingDirectory,
          session_id: sessionId,
          status: { type: "string", enum: ["open", "pending", "prompting", "answered", "aborted", "error"] },
          limit: { type: "number" },
        },
      },
    },
    {
      name: "hermes_submit_question_answer",
      description: "Submit a bounded structured answer by question ID; never proxies arbitrary terminal input. Returns an acceptance confirmation for the submitted answer. Use when answering a structured question raised by an OMX session. Pass question_id from hermes_list_questions, the answer object, and allow_mutation=true.",
      inputSchema: {
        type: "object",
        properties: {
          workingDirectory,
          session_id: sessionId,
          question_id: { type: "string" },
          answer: { type: "object" },
          answers: { type: "array", items: { type: "object" } },
          allow_mutation: allowMutation,
        },
        required: ["question_id", "allow_mutation"],
      },
    },
    {
      name: "hermes_list_artifacts",
      description: "List known safe result artifact files under .omx plans, specs, goals, context, and reports directories. Returns an array of artifact path strings. Use when discovering what deliverables a session has produced. Pass workingDirectory from the project root and optionally limit to cap entries.",
      inputSchema: { type: "object", properties: { workingDirectory, limit: { type: "number" } } },
    },
    {
      name: "hermes_read_artifact",
      description: "Read one safe .omx result artifact by relative path with byte truncation. Returns the artifact text content, truncated to a safe size. Use when reading a specific deliverable produced by a session. Pass path from the artifact path obtained via hermes_list_artifacts and optionally max_bytes to limit size.",
      inputSchema: {
        type: "object",
        properties: { workingDirectory, path: { type: "string" }, max_bytes: { type: "number" } },
        required: ["path"],
      },
    },
    {
      name: "hermes_report_status",
      description: "Write a small final or blocker status report for Hermes coordination without owning merge policy. Returns a report-acceptance confirmation. Use when signaling that a session has completed, is blocked, or has failed. Pass status from the outcome enum (running, blocked, failed, complete), summary text, and allow_mutation=true.",
      inputSchema: {
        type: "object",
        properties: {
          workingDirectory,
          session_id: sessionId,
          status: { type: "string", enum: ["running", "blocked", "failed", "complete"] },
          summary: { type: "string" },
          pr_url: { type: "string" },
          blocker: { type: "string" },
          allow_mutation: allowMutation,
        },
        required: ["status", "allow_mutation"],
      },
    },
  ];
}

const TOOL_HANDLERS: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  hermes_list_sessions: hermesListSessions,
  hermes_start_session: hermesStartSession,
  hermes_send_prompt: hermesSendPrompt,
  hermes_list_question_events: hermesListQuestionEvents,
  hermes_list_questions: hermesListQuestions,
  hermes_submit_question_answer: hermesSubmitQuestionAnswer,
  hermes_read_status: hermesReadStatus,
  hermes_read_tail: hermesReadTail,
  hermes_list_artifacts: hermesListArtifacts,
  hermes_read_artifact: hermesReadArtifact,
  hermes_report_status: hermesReportStatus,
};

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: buildHermesServerTools() }));

export async function handleHermesToolCall(request: {
  params: { name: string; arguments?: Record<string, unknown> };
}) {
  const { name, arguments: args = {} } = request.params;
  const handler = TOOL_HANDLERS[name];
  if (!handler) {
    return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
  const result = await handler(args);
  const isError = typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === false;
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    ...(isError ? { isError: true } : {}),
  };
}

server.setRequestHandler(CallToolRequestSchema, handleHermesToolCall);
autoStartStdioMcpServer("hermes", server);
