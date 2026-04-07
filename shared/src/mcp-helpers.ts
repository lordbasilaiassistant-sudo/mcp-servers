/**
 * Shared MCP response helpers.
 * Standardized result formatting for all MCP servers.
 */

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: McpTextContent[];
  isError?: boolean;
}

/**
 * Wrap a data object into MCP tool result format.
 * All tools should return through this helper for consistency.
 */
export function mcpResult(data: Record<string, unknown>, isError = false): McpToolResult {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

/**
 * Create a standardized error result with actionable suggestion.
 */
export function mcpError(error: string, suggestion?: string): McpToolResult {
  return mcpResult({ error, ...(suggestion ? { suggestion } : {}) }, true);
}

/**
 * Require an environment variable, returning an error result if missing.
 * Returns [value, null] on success, [null, McpToolResult] on failure.
 */
export function requireEnv(
  name: string,
  hint?: string
): [string, null] | [null, McpToolResult] {
  const value = process.env[name];
  if (!value) {
    return [
      null,
      mcpError(
        `${name} environment variable is not set.`,
        hint ?? `Set ${name} in your MCP server configuration or .env file.`
      ),
    ];
  }
  return [value, null];
}
