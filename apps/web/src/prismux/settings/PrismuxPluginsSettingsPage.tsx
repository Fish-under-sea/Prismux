import { SettingsPageContainer } from "../../components/settings/settingsLayout";
import { usePrismuxRuntime } from "../PrismuxRuntimeProvider";
import { PrismuxPluginCenterView } from "./plugins/PrismuxPluginCenterView";

/**
 * MP-04: /settings/plugins (Issue #8)
 * Cordis dual-track plugin center:
 * - Prominent zero-preinstall declaration for the 2 active official plugins (qq, fishdock-hook) + retired pet/ssh notice
 * - Four-state segmented tabs (all / installed / available / updates), instant search & category chips
 * - Default 12-item group cap with installed plugins permanently pinned in view
 * - Slide-over detail drawer with capability contributions, inline DeclarativeGlassRenderer, logs & rollback/uninstall
 * - Structured pre-install / pre-upgrade trust audit gate requiring explicit consent
 * - Community npm scriptless / gitless streaming tarball import
 */
export function PrismuxPluginsSettingsPage() {
  const { daemon, daemonInfo } = usePrismuxRuntime();

  return (
    <SettingsPageContainer width="wide">
      <PrismuxPluginCenterView daemon={daemon} daemonReady={daemonInfo.ready} />
    </SettingsPageContainer>
  );
}
