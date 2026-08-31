import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../../core/index.ts"
import { executeWorkspaceProcess } from "../workspace-process.ts"

type GitDiffInput = Record<string, never>

export class GitDiffTool implements Tool<GitDiffInput> {
  readonly definition = {
    name: "git_diff",
    description: "Returns the unstaged Git diff for the workspace.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  } satisfies Tool<GitDiffInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities() {
    return [{ type: "filesystem.read", path: this.workspaceRoot }] as const
  }

  async execute(
    _input: Readonly<GitDiffInput>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { output, error, exitCode } = await executeWorkspaceProcess(
      { command: ["git", "diff", "--no-ext-diff", "--"], cwd: this.workspaceRoot },
      context,
    )

    if (exitCode === 0) {
      return { success: true, output }
    }

    return {
      success: false,
      output,
      error: error.length === 0 ? `git diff exited with code ${exitCode}` : error.trimEnd(),
    }
  }
}
