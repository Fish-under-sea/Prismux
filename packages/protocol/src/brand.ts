export const DEFAULT_APP_VERSION = "0.2.1-rc.2" as const;

export const BRAND = {
  appName: "Prismux",
  appSlug: "prismux",
  npmScope: "@prismux",
  pluginPrefix: "prismux-plugin-",
  dataDirName: ".prismux",
  uriScheme: "prismux",
  githubTopic: "prismux-plugin",
  backupExtension: ".prismux-backup",
  themeExtension: ".wb-theme",
  pluginArchiveExtension: ".wb-plugin",
  chiefWorkspaceDir: "chief-workspace"
} as const;

export type BrandConfig = typeof BRAND;

export function formatOfficialPluginPackageName(pluginId: string): string {
  return `${BRAND.npmScope}/plugin-${pluginId}`;
}

export function formatCommunityPluginPackageName(pluginId: string): string {
  return `${BRAND.pluginPrefix}${pluginId}`;
}
