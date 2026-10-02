export interface ToolCommand { command: string; args: string[]; shell: boolean }
export const TOOL_PACKAGES: Record<'tsc' | 'tsx' | 'vite', string>;
export function binEntry(pkg: string, bin?: string, options?: { from?: string }): string;
export function toolCommand(name: 'tsc' | 'tsx' | 'vite', args?: string[], options?: { from?: string }): ToolCommand;
export function npmCommand(args?: string[], options?: { env?: Record<string, string | undefined>; platform?: string; execPath?: string; exists?: (path: string) => boolean }): ToolCommand;
