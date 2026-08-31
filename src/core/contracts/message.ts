import type { ToolCall, ToolResult } from "./tool.ts"

type NonEmptyReadonlyArray<T> = readonly [T, ...T[]]

export type AgentMessage =
  | {
      readonly role: "system"
      readonly content: string
    }
  | {
      readonly role: "user"
      readonly content: string
    }
  | {
      readonly role: "assistant"
      readonly content: string
      readonly toolCalls?: never
    }
  | {
      readonly role: "assistant"
      readonly content?: string
      readonly toolCalls: NonEmptyReadonlyArray<ToolCall>
    }
  | {
      readonly role: "tool"
      readonly result: ToolResult
    }
