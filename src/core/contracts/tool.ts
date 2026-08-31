import type { JSONSchemaType, SchemaObject } from "ajv"

export type ToolCall = {
  readonly id: string
  readonly name: string
  readonly arguments: Readonly<Record<string, unknown>>
}

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

export type ToolIdentity = {
  readonly id: string
  readonly version: string
  readonly name?: string
}

export type ToolIdentityInput = {
  readonly id?: string
  readonly name?: string
  readonly version: string
}

export type ToolIdentityHook = ToolIdentityInput | string | (() => ToolIdentityInput | string)

export type ToolExecutionDescriptor = JsonValue

export type ToolExecutionFailure = {
  readonly kind: "thrown"
  readonly name: string
  readonly message: string
}

export type ToolExecutionResult =
  | {
      readonly success: true
      readonly output: string
    }
  | {
      readonly success: false
      readonly output: string
      readonly error: string
    }

export type ToolResult = ToolExecutionResult & {
  readonly toolCallId: string
  readonly failure?: ToolExecutionFailure
}

export type ToolDefinition = {
  readonly name: string
  readonly description: string
  readonly inputSchema: SchemaObject
}

export type Capability =
  | {
      readonly type: "filesystem.read"
      readonly path: string
    }
  | {
      readonly type: "filesystem.write"
      readonly path: string
    }
  | {
      readonly type: "process.execute"
      readonly command: string
    }
  | {
      readonly type: "network.access"
      readonly host: string
    }

export type ToolExecutionContext = {
  readonly signal: AbortSignal
  readonly cleanup?: {
    readonly graceMs?: number
    readonly cleanupTimeoutMs?: number
  }
}

export interface Tool<TInput extends object> {
  readonly definition: ToolDefinition & {
    readonly inputSchema: JSONSchemaType<TInput>
  }
  readonly identity?: ToolIdentityHook
  readonly executionDescriptor?:
    | ToolExecutionDescriptor
    | ((input: Readonly<TInput>) => ToolExecutionDescriptor)
  readonly capabilities: (input: Readonly<TInput>) => readonly Capability[]
  readonly execute: (
    input: Readonly<TInput>,
    context: ToolExecutionContext,
  ) => Promise<ToolExecutionResult>
}
