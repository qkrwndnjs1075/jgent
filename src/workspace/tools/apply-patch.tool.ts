import type { Tool, ToolExecutionContext, ToolExecutionResult } from "../../core/index.ts"
import { executeWorkspaceProcess } from "../workspace-process.ts"

type ApplyPatchInput = {
  readonly patch: string
}

export class ApplyPatchTool implements Tool<ApplyPatchInput> {
  readonly definition = {
    name: "apply_patch",
    description: "Applies a unified diff to files in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        patch: { type: "string", minLength: 1 },
      },
      required: ["patch"],
      additionalProperties: false,
    },
  } satisfies Tool<ApplyPatchInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  capabilities() {
    return [{ type: "filesystem.write", path: this.workspaceRoot }] as const
  }

  async execute(
    input: Readonly<ApplyPatchInput>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { output, error, exitCode } = await executeWorkspaceProcess(
      {
        command: ["git", "apply", "--whitespace=nowarn", "-"],
        cwd: this.workspaceRoot,
        stdin: input.patch,
      },
      context,
    )

    if (exitCode === 0) {
      return { success: true, output: output.length === 0 ? "Applied patch" : output }
    }

    return {
      success: false,
      output,
      error: error.length === 0 ? `git apply exited with code ${exitCode}` : error.trimEnd(),
    }
  }
}
