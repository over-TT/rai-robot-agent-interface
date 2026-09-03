export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

export interface WebMcpExecutionOptions {
  signal: AbortSignal
}

export interface WebMcpToolDefinition {
  name: string
  title?: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: WebMcpToolAnnotations
  /**
   * The current draft requires execution options, but some WebMCP hosts still
   * invoke the callback with only the input object. Treat the options as an
   * optional compatibility boundary while preserving cancellation when a host
   * supplies its AbortSignal.
   */
  execute(input: Record<string, unknown>, options?: WebMcpExecutionOptions): Promise<unknown>
}

export interface WebMcpModelContext {
  registerTool(
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal; exposedTo?: string[] },
  ): Promise<void>
}

export interface WebMcpDocument {
  modelContext?: WebMcpModelContext
}

export interface WebMcpRegistration {
  supported: boolean
  toolNames: string[]
  ready: Promise<void>
  dispose(): void
}
