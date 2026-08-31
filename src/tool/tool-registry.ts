import type {
  Capability,
  Tool,
  ToolExecutionContext,
  ToolExecutionDescriptor,
  ToolExecutionResult,
  ToolIdentity,
  ToolIdentityHook,
  ToolIdentityInput,
} from "../core/contracts/tool.ts"
import { canonicalize, canonicalJson, computeEffectDigest, deepFreeze } from "./effect-digest.ts"
import type { ToolValidator } from "./tool-validator.ts"

const DEFAULT_TOOL_VERSION = "1"
const DEFAULT_EXECUTION_DESCRIPTOR = {
  kind: "registered-tool",
  version: DEFAULT_TOOL_VERSION,
} as const

export type PreparedToolExecution =
  | {
      readonly valid: true
      readonly input: object
      readonly toolIdentity: ToolIdentity
      readonly executionDescriptor: ToolExecutionDescriptor
      readonly capabilities: readonly Capability[]
      readonly execute: (context: ToolExecutionContext) => Promise<ToolExecutionResult>
    }
  | {
      readonly valid: false
      readonly error: string
    }

export interface RegisteredTool {
  readonly prepare: (validator: ToolValidator, input: unknown) => PreparedToolExecution
}

export interface ToolRegistry {
  readonly get: (name: string) => RegisteredTool | undefined
}

export class DuplicateToolError extends Error {
  readonly name = "DuplicateToolError"

  constructor(readonly toolName: string) {
    super(`Tool "${toolName}" is already registered`)
  }
}

export class InMemoryToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>()

  register<TInput extends object>(tool: Tool<TInput>): void {
    const { name, inputSchema } = tool.definition

    if (this.#tools.has(name)) {
      throw new DuplicateToolError(name)
    }

    const execute = tool.execute.bind(tool)
    const capabilities = tool.capabilities.bind(tool)
    const identityHook = bindIdentityHook(tool.identity, tool)
    const identity = deepFreeze(canonicalize(resolveIdentity(name, identityHook)))
    const descriptor = bindDescriptorHook(tool.executionDescriptor, tool)

    this.#tools.set(name, {
      prepare: (validator, input) => {
        const validation = validator.validate(inputSchema, structuredClone(input))

        if (!validation.valid) {
          return validation
        }

        const frozenInput = deepFreeze(canonicalize(validation.input))
        const frozenCapabilities = prepareCapabilities(capabilities(frozenInput))
        const executionDescriptor = deepFreeze(
          canonicalize(resolveDescriptor(descriptor, frozenInput)),
        )
        const preparedExecute = (context: ToolExecutionContext) => execute(frozenInput, context)

        return deepFreeze({
          valid: true,
          input: frozenInput,
          toolIdentity: identity,
          executionDescriptor,
          capabilities: frozenCapabilities,
          execute: preparedExecute,
        })
      },
    })
  }

  get(name: string): RegisteredTool | undefined {
    return this.#tools.get(name)
  }
}

function resolveIdentity(name: string, hook: ToolIdentityHook | undefined): ToolIdentity {
  const value =
    hook === undefined
      ? { id: name, name, version: DEFAULT_TOOL_VERSION }
      : resolveIdentityHook(hook)
  if (typeof value === "string") {
    return { id: name, name, version: value }
  }
  if (value.name !== undefined && value.name !== name) {
    throw new TypeError(`Tool identity name must match definition name "${name}"`)
  }
  const id = value.id ?? name
  if (id.length === 0 || value.version.length === 0) {
    throw new TypeError(`Tool identity for "${name}" must include id and version`)
  }
  return { id, name, version: value.version }
}

function resolveIdentityHook(hook: ToolIdentityHook): ToolIdentityInput | string {
  return typeof hook === "function" ? hook() : hook
}

function bindIdentityHook<TInput extends object>(
  hook: Tool<TInput>["identity"],
  receiver: Tool<TInput>,
): Tool<TInput>["identity"] {
  return typeof hook === "function" ? hook.bind(receiver) : hook
}

function bindDescriptorHook<TInput extends object>(
  hook: Tool<TInput>["executionDescriptor"],
  receiver: Tool<TInput>,
): Tool<TInput>["executionDescriptor"] {
  return typeof hook === "function" ? hook.bind(receiver) : hook
}

function resolveDescriptor<TInput extends object>(
  descriptor:
    | ToolExecutionDescriptor
    | ((input: Readonly<TInput>) => ToolExecutionDescriptor)
    | undefined,
  input: Readonly<TInput>,
): ToolExecutionDescriptor {
  return descriptor === undefined
    ? DEFAULT_EXECUTION_DESCRIPTOR
    : typeof descriptor === "function"
      ? descriptor(input)
      : descriptor
}

function prepareCapabilities(capabilities: readonly Capability[]): readonly Capability[] {
  const canonicalCapabilities = capabilities.map((capability) => canonicalize(capability))
  canonicalCapabilities.sort((left, right) =>
    compareStrings(canonicalJson(left), canonicalJson(right)),
  )
  return deepFreeze(canonicalCapabilities)
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

export { computeEffectDigest }
