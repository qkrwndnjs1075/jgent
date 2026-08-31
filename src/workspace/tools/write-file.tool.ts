import { writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import type { Tool, ToolExecutionContext } from "../../core/index.ts"

type WriteFileInput = {
  readonly path: string
  readonly content: string
}

export class WriteFileTool implements Tool<WriteFileInput> {
  readonly definition = {
    name: "write_file",
    description: "Creates or replaces a UTF-8 file in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", minLength: 1 },
        content: { type: "string" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  } satisfies Tool<WriteFileInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities(input: Readonly<WriteFileInput>) {
    return [{ type: "filesystem.write", path: resolve(this.workspaceRoot, input.path) }] as const
  }

  async execute(input: Readonly<WriteFileInput>, context: ToolExecutionContext) {
    await writeFile(resolve(this.workspaceRoot, input.path), input.content, {
      encoding: "utf8",
      signal: context.signal,
    })
    return {
      success: true,
      output: `Wrote file: ${input.path}`,
    } as const
  }
}
