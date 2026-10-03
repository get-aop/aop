import type { JiraConnection, LinearConnection, Project } from "@aop/common";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/ui/button";
import { getLinearConnection } from "../../api/issues";
import { getJiraConnection } from "../../api/jira";
import { useIsHostOwner } from "../../settings/use-host-owner";
import { JiraConnectDialog } from "../issues/jira/JiraConnectDialog";
import { LinearConnectDialog } from "../issues/LinearConnectDialog";
import { JiraMark, LinearMark } from "../issues/source-marks";
import { SettingRow, SettingsGroup } from "./blocks";

type Tracker = "linear" | "jira";

/** A connection read: not yet, the connection, or that the host did not answer. */
type Read<T> = T | null | "failed";

/**
 * Where the Issues tab reads issues from besides GitHub: the project's Linear and Jira
 * connections, each opening the same dialog as the tab's buttons. GitHub needs nothing here: it
 * is the repositories in Environment, read with the host's `gh`.
 */
export const IssueSourcesSection = ({ project }: { project: Project }) => {
  const owner = useIsHostOwner(true);
  const [open, setOpen] = useState<Tracker | null>(null);
  const { linear, jira, reload } = useConnections(project.id);
  return (
    <SettingsGroup testId="settings-issue-sources">
      <SettingRow
        testId="settings-issue-source-linear"
        label="Linear"
        description={<LinearState connection={linear} />}
        control={
          <Button
            size="sm"
            variant="secondary"
            data-testid="settings-linear"
            onClick={() => setOpen("linear")}
          >
            <LinearMark className="size-3.5" />
            {isConfigured(linear) ? "Manage" : "Connect"}
          </Button>
        }
      />
      <SettingRow
        testId="settings-issue-source-jira"
        label="Jira"
        description={<JiraState connection={jira} />}
        control={
          <Button
            size="sm"
            variant="secondary"
            data-testid="settings-jira"
            onClick={() => setOpen("jira")}
          >
            <JiraMark className="size-3.5" />
            {isConfigured(jira) ? "Manage" : "Connect"}
          </Button>
        }
      />
      <LinearConnectDialog
        projectId={project.id}
        open={open === "linear"}
        owner={owner}
        onOpenChange={(next) => setOpen(next ? "linear" : null)}
        onChanged={reload}
      />
      <JiraConnectDialog
        projectId={project.id}
        open={open === "jira"}
        owner={owner}
        onOpenChange={(next) => setOpen(next ? "jira" : null)}
        onChanged={reload}
      />
    </SettingsGroup>
  );
};

const LinearState = ({ connection }: { connection: Read<LinearConnection> }) => {
  if (connection === "failed") return <>Could not read the connection.</>;
  if (!connection) return <>Reading…</>;
  if (!connection.configured || !connection.scope) return <>Not connected.</>;
  return (
    <>
      {connection.scope.kind === "project" ? "Project" : "Team"} {connection.scope.name}
      {connection.workspace ? ` in ${connection.workspace}` : ""}.
    </>
  );
};

const JiraState = ({ connection }: { connection: Read<JiraConnection> }) => {
  if (connection === "failed") return <>Could not read the connection.</>;
  if (!connection) return <>Reading…</>;
  if (!connection.configured) return <>Not connected.</>;
  const shows = connection.filter?.projects.length
    ? connection.filter.projects.join(", ")
    : "a JQL query";
  return (
    <>
      {connection.siteUrl?.replace(/^https?:\/\//, "")} as {connection.account}: {shows}.
    </>
  );
};

const isConfigured = (read: Read<{ configured: boolean }>): boolean =>
  read !== null && read !== "failed" && read.configured;

/** Both connections, read when the section opens and again after a dialog changed one. */
const useConnections = (projectId: string) => {
  const [linear, setLinear] = useState<Read<LinearConnection>>(null);
  const [jira, setJira] = useState<Read<JiraConnection>>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    void attempt;
    let current = true;
    getLinearConnection(projectId).then(
      (read) => current && setLinear(read),
      () => current && setLinear("failed"),
    );
    getJiraConnection(projectId).then(
      (read) => current && setJira(read),
      () => current && setJira("failed"),
    );
    return () => {
      current = false;
    };
  }, [projectId, attempt]);
  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { linear, jira, reload };
};
