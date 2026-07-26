import { t } from './i18n.js';

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  /** Carried to the MCP App only; hosts keep it out of the model's context. */
  _meta?: Record<string, unknown>;
};

export function toolOk(payload: unknown, characterLimit: number): ToolResult {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  const output =
    text.length <= characterLimit
      ? text
      : `${text.slice(0, characterLimit)}\n\n${t.tool.truncated(text.length - characterLimit)}`;
  return { content: [{ type: 'text', text: output }] };
}

export function toolFail(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: t.tool.error(message) }],
    isError: true
  };
}

export async function guardTool(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return toolFail(error instanceof Error ? error.message : String(error));
  }
}
