import { resolve } from "node:path"
import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../../core/index.ts"
import { executeWorkspaceProcess } from "../workspace-process.ts"

type GrepInput = {
  readonly query: string
  readonly path: string
}

export class GrepTool implements Tool<GrepInput> {
  readonly definition = {
    name: "grep",
    description: "Searches workspace text with ripgrep and returns path, line number, and content.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1 },
        path: { type: "string", minLength: 1 },
      },
      required: ["query", "path"],
      additionalProperties: false,
    },
  } satisfies Tool<GrepInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities(input: Readonly<GrepInput>) {
    return [{ type: "filesystem.read", path: resolve(this.workspaceRoot, input.path) }] as const
  }

  async execute(
    input: Readonly<GrepInput>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { output, error, exitCode } = await executeWorkspaceProcess(
      {
        command: [
          "rg",
          "--line-number",
          "--no-heading",
          "--color",
          "never",
          "--",
          input.query,
          input.path,
        ],
        cwd: this.workspaceRoot,
      },
      context,
    )

    if (exitCode === 0 || exitCode === 1) {
      return { success: true, output }
    }

    return {
      success: false,
      output,
      error: error.length === 0 ? `ripgrep exited with code ${exitCode}` : error.trimEnd(),
    }
  }
}
