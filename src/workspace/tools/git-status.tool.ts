import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../../core/index.ts"
import { executeWorkspaceProcess } from "../workspace-process.ts"

type GitStatusInput = Record<string, never>

export class GitStatusTool implements Tool<GitStatusInput> {
  readonly definition = {
    name: "git_status",
    description: "Returns the short Git worktree status for the workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  } satisfies Tool<GitStatusInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities() {
    return [{ type: "filesystem.read", path: this.workspaceRoot }] as const
  }

  async execute(
    _input: Readonly<GitStatusInput>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { output, error, exitCode } = await executeWorkspaceProcess(
      { command: ["git", "status", "--short"], cwd: this.workspaceRoot },
      context,
    )

    if (exitCode === 0) {
      return { success: true, output }
    }

    return {
      success: false,
      output,
      error: error.length === 0 ? `git status exited with code ${exitCode}` : error.trimEnd(),
    }
  }
}
