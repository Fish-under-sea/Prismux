import { EnvironmentId } from "@prismux/core-contracts";
import { T, useGT } from "gt-react";
import { LayersIcon } from "lucide-react";

import { Button } from "../ui/button";
import { ArchivedThreadsPanel } from "./ArchivedThreadsPanel";
import { NewProjectsSettingsSection } from "./ProjectDefaultsSettings";
import { ProjectSettingsPanel } from "./ProjectSettingsPanel";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsScopeNotice } from "./SettingsScopeNotice";
import { SettingsSegmentedTabs, type SettingsSegmentedTabItem } from "./SettingsSegmentedTabs";
import { SettingsPageContainer } from "./settingsLayout";
import { ALL_ENVIRONMENTS_VALUE, selectEnvironmentAxis } from "./settingsScopeAxis";

export const PROJECTS_TAB_IDS = {
  projects: "projects",
  archived: "archived",
} as const;

export const PROJECTS_TAB_HASH_ANCHORS = {
  projects: [
    "projects",
    "new-projects",
    "add-project-starts-in",
    "ghq-clone-layout",
    "project-overview",
    "project-defaults",
    "project-actions",
    "project-repositories",
  ] as const,
  archived: ["archived", "archived-threads", "archive"] as const,
} as const;

export function ProjectsSettings() {
  const gt = useGT();
  const { search: value, scope, selectScope } = useSettingsScope();
  const unavailableContent =
    scope.kind === "unavailable" ? (
      <div className="flex flex-col items-start gap-3">
        <p className="text-sm text-muted-foreground">{scope.message}</p>
        {value.machine || value.checkout ? (
          <Button
            variant="outline"
            size="xs"
            onClick={() => selectScope(selectEnvironmentAxis(value, ALL_ENVIRONMENTS_VALUE))}
          >
            <LayersIcon />
            <T>Show all environments</T>
          </Button>
        ) : null}
      </div>
    ) : null;
  // Keep the panel mounted so it can follow members when regrouping changes the project key.
  const projectScope =
    scope.kind === "project" ||
    scope.kind === "checkout" ||
    (scope.kind === "unavailable" &&
      (scope.reason === "project-missing" || scope.reason === "checkout-missing"));

  const projectsTabContent =
    value.project && projectScope ? (
      <div
        id="projects"
        className="flex flex-col gap-7 [&_[data-settings-page-scroll]]:flex-none [&_[data-settings-page-scroll]]:overflow-visible [&_[data-settings-page-scroll]]:[mask-image:none] [&_[data-settings-page-scroll]]:[-webkit-mask-image:none] [&_[data-settings-page-scroll]]:[scrollbar-gutter:auto] [&_[data-settings-page-scroll]>div]:max-w-none [&_[data-settings-page-scroll]>div]:p-0"
      >
        <ProjectSettingsPanel
          projectKey={value.project}
          environmentId={value.machine ? EnvironmentId.make(value.machine) : null}
          checkoutKey={value.checkout ?? null}
          unavailable={unavailableContent}
        />
      </div>
    ) : unavailableContent ? (
      <div id="projects">{unavailableContent}</div>
    ) : (
      <div id="projects" className="flex flex-col gap-7">
        <NewProjectsSettingsSection />
        <SettingsScopeNotice target="project" inline>
          {gt("Choose a project to manage its name, icon, checkouts and actions.")}
        </SettingsScopeNotice>
      </div>
    );

  const tabs: ReadonlyArray<SettingsSegmentedTabItem> = [
    {
      id: PROJECTS_TAB_IDS.projects,
      label: gt("Project configuration"),
      hashAnchors: PROJECTS_TAB_HASH_ANCHORS.projects,
      content: projectsTabContent,
    },
    {
      id: PROJECTS_TAB_IDS.archived,
      label: gt("Archived threads"),
      hashAnchors: PROJECTS_TAB_HASH_ANCHORS.archived,
      content: (
        <div id="archived" className="flex flex-col gap-7">
          <ArchivedThreadsPanel embedded />
        </div>
      ),
    },
  ];

  return (
    <SettingsPageContainer>
      <SettingsSegmentedTabs
        tabs={tabs}
        defaultTabId={PROJECTS_TAB_IDS.projects}
        ariaLabel={gt("Projects and archive settings sections")}
      />
    </SettingsPageContainer>
  );
}
