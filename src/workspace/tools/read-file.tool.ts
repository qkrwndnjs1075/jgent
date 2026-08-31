import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Tool, ToolExecutionContext } from "../../core/index.ts"

type ReadFileInput = {
  readonly path: string
}

export class ReadFileTool implements Tool<ReadFileInput> {
  readonly definition = {
    name: "read_file",
    description: "Reads a UTF-8 file from the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  } satisfies Tool<ReadFileInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities(input: Readonly<ReadFileInput>) {
    return [{ type: "filesystem.read", path: resolve(this.workspaceRoot, input.path) }] as const
  }

  async execute(input: Readonly<ReadFileInput>, context: ToolExecutionContext) {
    return {
      success: true,
      output: await readFile(resolve(this.workspaceRoot, input.path), {
        encoding: "utf8",
        signal: context.signal,
      }),
    } as const
  }
}
