import type { AcpRegistrySettings } from "../settings.ts";
import { isDeepSeekHarnessSpawn } from "./dshLocal.ts";

// AcpRegistrySupport.validateLocalExecutable refuses arbitrary .cmd/.bat on Windows, so only
// native executables (or safely unwrapped Node/Electron launchers) are launchable.
const COMMAND_CODE_EXECUTABLES = /^(?:cmdc|command-code|commandcode)(?:\.exe)?$/iu;
const COMMAND_CODE_ENTRY_POINTS = [
  /(?:^|[\\/])node_modules[\\/]command-code[\\/]/iu,
  /(?:^|[\\/])command-code[\\/]dist[\\/](?:index|cli)\.mjs$/iu,
];

/**
 * Agents that take T3's MCP endpoint over ACP HTTP: Command Code cannot start the stdio
 * bridge on Windows, where it spawns MCP commands through cmd.exe and the unquoted T3
 * executable path splits at the space; DeepSeek Harness (`dsh`) advertises native HTTP MCP
 * (`mcpCapabilities: { http: true }`), avoiding Windows `.cmd` stdio bridge failures.
 */
export function prefersHttpMcpTransport(settings: AcpRegistrySettings): boolean {
  if (settings.source !== "local") {
    return false;
  }
  const executable = settings.commandPath.split(/[\\/]/u).pop() ?? "";
  return (
    COMMAND_CODE_EXECUTABLES.test(executable) ||
    isDeepSeekHarnessSpawn(settings.commandPath, settings.commandArgs) ||
    settings.commandArgs.some((argument) =>
      COMMAND_CODE_ENTRY_POINTS.some((pattern) => pattern.test(argument)),
    )
  );
}
