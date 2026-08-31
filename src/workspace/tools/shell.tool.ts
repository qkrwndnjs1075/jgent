import type {
  Tool,
  ToolExecutionContext,
  ToolExecutionDescriptor,
  ToolExecutionResult,
} from "../../core/index.ts"
import { executeWorkspaceProcess } from "../workspace-process.ts"

type ShellInput = {
  readonly command: string
}

export class ShellTool implements Tool<ShellInput> {
  readonly definition = {
    name: "shell",
    description: "Runs a shell command from the workspace root.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", minLength: 1 },
      },
      required: ["command"],
      additionalProperties: false,
    },
  } satisfies Tool<ShellInput>["definition"]

  constructor(private readonly workspaceRoot: string) {}

  get executionDescriptor(): ToolExecutionDescriptor {
    return { kind: "workspace-shell", cwd: this.workspaceRoot }
  }

  capabilities(input: Readonly<ShellInput>) {
    return [{ type: "process.execute", command: input.command }] as const
  }

  async execute(
    input: Readonly<ShellInput>,
    context: ToolExecutionContext,
  ): Promise<ToolExecutionResult> {
    const { output, error, exitCode } = await executeWorkspaceProcess(
      { command: ["/bin/sh", "-c", input.command], cwd: this.workspaceRoot },
      context,
    )

    if (exitCode === 0) {
      return { success: true, output: `${output}${error}` }
    }

    return {
      success: false,
      output,
      error: `Command exited with code ${exitCode}${error.length === 0 ? "" : `\n${error.trimEnd()}`}`,
    }
  }
}
