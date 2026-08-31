import { resolve } from "node:path"
import type { Tool, ToolDefinition } from "../../core/index.ts"
import { InMemoryToolRegistry } from "../../tool/index.ts"
import { ApplyPatchTool } from "./apply-patch.tool.ts"
import { GitDiffTool } from "./git-diff.tool.ts"
import { GitStatusTool } from "./git-status.tool.ts"
import { GrepTool } from "./grep.tool.ts"
import { ListDirectoryTool } from "./list-directory.tool.ts"
import { ReadFileTool } from "./read-file.tool.ts"
import { ShellTool } from "./shell.tool.ts"
import { WriteFileTool } from "./write-file.tool.ts"

export type WorkspaceToolSet = {
  readonly registry: InMemoryToolRegistry
  readonly definitions: readonly ToolDefinition[]
}

export function createWorkspaceToolSet(workspaceRoot: string): WorkspaceToolSet {
  const root = resolve(workspaceRoot)
  const registry = new InMemoryToolRegistry()
  const definitions: ToolDefinition[] = []

  registerTool(registry, definitions, new ReadFileTool(root))
  registerTool(registry, definitions, new ListDirectoryTool(root))
  registerTool(registry, definitions, new GrepTool(root))
  registerTool(registry, definitions, new GitStatusTool(root))
  registerTool(registry, definitions, new GitDiffTool(root))
  registerTool(registry, definitions, new WriteFileTool(root))
  registerTool(registry, definitions, new ApplyPatchTool(root))
  registerTool(registry, definitions, new ShellTool(root))

  return { registry, definitions }
}

function registerTool<TInput extends object>(
  registry: InMemoryToolRegistry,
  definitions: ToolDefinition[],
  tool: Tool<TInput>,
): void {
  registry.register(tool)
  definitions.push(tool.definition)
}

export { ApplyPatchTool } from "./apply-patch.tool.ts"
export { GitDiffTool } from "./git-diff.tool.ts"
export { GitStatusTool } from "./git-status.tool.ts"
export { GrepTool } from "./grep.tool.ts"
export { ListDirectoryTool } from "./list-directory.tool.ts"
export { ReadFileTool } from "./read-file.tool.ts"
export { ShellTool } from "./shell.tool.ts"
export { WriteFileTool } from "./write-file.tool.ts"
