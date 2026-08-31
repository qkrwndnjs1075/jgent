import { readdir } from "node:fs/promises"
import { resolve } from "node:path"
import type { Tool, ToolExecutionContext } from "../../core/index.ts"

type ListDirectoryInput = {
  readonly path: string
}

export class ListDirectoryTool implements Tool<ListDirectoryInput> {
  readonly definition = {
    name: "list_directory",
    description: "Lists files and directories in stable name order.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  } satisfies Tool<ListDirectoryInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities(input: Readonly<ListDirectoryInput>) {
    return [{ type: "filesystem.read", path: resolve(this.workspaceRoot, input.path) }] as const
  }

  async execute(input: Readonly<ListDirectoryInput>, context: ToolExecutionContext) {
    context.signal.throwIfAborted()
    const entries = await readdir(resolve(this.workspaceRoot, input.path), { withFileTypes: true })
    context.signal.throwIfAborted()
    entries.sort((left, right) => left.name.localeCompare(right.name))
    const output = entries
      .map((entry) => {
        if (entry.isDirectory()) {
          return `directory\t${entry.name}`
        }
        if (entry.isFile()) {
          return `file\t${entry.name}`
        }
        if (entry.isSymbolicLink()) {
          return `symlink\t${entry.name}`
        }
        return `other\t${entry.name}`
      })
      .join("\n")

    return { success: true, output } as const
  }
}
