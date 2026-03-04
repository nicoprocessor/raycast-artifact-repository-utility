import {
  Action,
  ActionPanel,
  Alert,
  Clipboard,
  Color,
  Icon,
  List,
  confirmAlert,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { execFile } from "node:child_process";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo, useState } from "react";
import { AddProviderForm } from "./manage-providers";
import { getProviderClients, providerIcon } from "./providers";
import { ProviderKind, RegistryImage, RegistryProvider, VulnerabilitySummary } from "./providers/types";
import { buildFullArtifactPath } from "./utils/image-reference";

type FavoriteProject = { providerId: string; name: string };

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function severityBadge(scanStatus: RegistryImage["scanStatus"], summary: VulnerabilitySummary) {
  if (scanStatus === "not-scanned") {
    return { text: "Not scanned", icon: Icon.Clock, color: Color.SecondaryText };
  }
  if (summary.critical > 0) return { text: `Critical ${summary.critical}`, icon: Icon.Dot, color: Color.Red };
  if (summary.high > 0) return { text: `High ${summary.high}`, icon: Icon.Dot, color: Color.Orange };
  if (summary.medium > 0) return { text: `Medium ${summary.medium}`, icon: Icon.Dot, color: Color.Yellow };
  if (summary.low > 0) return { text: `Low ${summary.low}`, icon: Icon.Dot, color: Color.Blue };
  return { text: "Scanned: no vulnerabilities", icon: Icon.CheckCircle, color: Color.Green };
}

function vulnDetail(summary: VulnerabilitySummary) {
  return `critical:${summary.critical} · high:${summary.high} · medium:${summary.medium} · low:${summary.low} · unknown:${summary.unknown}`;
}

function escapeForAppleScript(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runInTerminal(command: string): Promise<void> {
  const escaped = escapeForAppleScript(command);
  await new Promise<void>((resolve, reject) => {
    execFile(
      "osascript",
      ["-e", 'tell application "Terminal"', "-e", "activate", "-e", `do script "${escaped}"`, "-e", "end tell"],
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

function ProjectMembersDetail(props: { provider: RegistryProvider; projectName: string }) {
  const { data, isLoading } = useCachedPromise(
    (projectName: string) => props.provider.listProjectMembers(projectName),
    [props.projectName],
    {
      keepPreviousData: true,
    },
  );

  const members = data ?? [];

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Project members" throttle>
      {members.length === 0 ? (
        <List.EmptyView
          title="No members found"
          description="Members may be unavailable for this provider or your role."
        />
      ) : null}
      {members.map((member) => (
        <List.Item
          key={member.id}
          icon={Icon.Person}
          title={member.username}
          accessories={[{ text: member.role }]}
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Username" content={member.username} />
              <Action.CopyToClipboard title="Copy Role" content={member.role} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

function RepositoryArtifactsDetail(props: {
  provider: RegistryProvider;
  providerKind: ProviderKind;
  providerBaseUrl?: string;
  projectName: string;
  repositoryName: string;
}) {
  const [searchText, setSearchText] = useState("");
  const [hideUntagged, setHideUntagged] = useState(false);
  const { data, isLoading, revalidate } = useCachedPromise(
    (projectName: string, repositoryName: string, query: string) =>
      props.provider.listRepositoryArtifacts(projectName, repositoryName, query),
    [props.projectName, props.repositoryName, searchText],
    {
      keepPreviousData: true,
    },
  );

  const images = useMemo(
    () => (data ?? []).filter((image) => (hideUntagged ? image.tag.toLowerCase() !== "untagged" : true)),
    [data, hideUntagged],
  );

  async function copyText(content: string, title: string) {
    await Clipboard.copy(content);
    await showToast({ style: Toast.Style.Success, title, message: content });
  }

  async function onPullLocally(fullArtifactPath: string) {
    const pullCommand = `docker pull ${fullArtifactPath}`;
    await showToast({ style: Toast.Style.Animated, title: "Starting local pull...", message: pullCommand });
    await runInTerminal(pullCommand);
    await showToast({ style: Toast.Style.Success, title: "Docker pull started in Terminal", message: pullCommand });
  }

  async function runArtifactAction(action: () => Promise<void>, loadingTitle: string, doneTitle: string) {
    await showToast({ style: Toast.Style.Animated, title: loadingTitle });
    await action();
    await revalidate();
    await showHUD(doneTitle);
  }

  async function onDeleteTag(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete tag ${image.tag}?`,
      message: `${image.repository}:${image.tag}`,
      primaryAction: { title: "Delete Tag", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await runArtifactAction(
      () => props.provider.deleteTag(image.project, image.repositoryName, image.digest, image.tag),
      "Deleting tag...",
      "Tag deleted",
    );
  }

  async function onDeleteArtifact(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete artifact ${image.digest.slice(0, 16)}...?`,
      message: image.repository,
      primaryAction: { title: "Delete Artifact", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    await runArtifactAction(
      () => props.provider.deleteArtifact(image.project, image.repositoryName, image.digest),
      "Deleting artifact...",
      "Artifact deleted",
    );
  }

  async function onTriggerScan(image: RegistryImage) {
    await runArtifactAction(
      () => props.provider.triggerScan(image.project, image.repositoryName, image.digest),
      "Starting scan...",
      "Scan started",
    );
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search artifacts in repository"
      throttle
      isShowingDetail
    >
      {images.length === 0 ? <List.EmptyView title="No artifacts found" /> : null}
      {images.map((image) => {
        const severity = severityBadge(image.scanStatus, image.vulnerabilitySummary);
        const fullArtifactPath = buildFullArtifactPath(
          props.providerKind,
          image.repository,
          image.tag,
          props.providerBaseUrl,
        );
        return (
          <List.Item
            key={image.id}
            icon={Icon.Box}
            title={image.tag}
            subtitle={image.repository}
            accessories={[{ icon: { source: severity.icon, tintColor: severity.color }, tooltip: severity.text }]}
            detail={
              <List.Item.Detail
                markdown={[
                  `# ${image.repository}:${image.tag}`,
                  `- **Provider:** ${image.providerLabel}`,
                  `- **Project:** ${image.project}`,
                  `- **Digest:** \`${image.digest}\``,
                  `- **Size:** ${formatBytes(image.sizeBytes)}`,
                  `- **Pushed At:** ${image.pushedAt ? new Date(image.pushedAt).toLocaleString() : "-"}`,
                  `- **Scan Status:** ${image.scanStatus}`,
                  `- **Vulnerabilities:** ${vulnDetail(image.vulnerabilitySummary)}`,
                ].join("\n")}
              />
            }
            actions={
              <ActionPanel>
                <Action title="Copy Tag" onAction={() => copyText(image.tag, "Tag copied")} />
                <Action
                  title="Copy Full Artifact Path"
                  shortcut={{ modifiers: ["cmd"], key: "enter" }}
                  onAction={() => copyText(fullArtifactPath, "Full artifact path copied")}
                />
                <Action
                  title="Pull Locally (Docker)"
                  icon={Icon.Download}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                  onAction={() => onPullLocally(fullArtifactPath)}
                />
                <Action title="Copy Digest" onAction={() => copyText(image.digest, "Digest copied")} />
                <Action.OpenInBrowser title="Open Artifact in Browser" url={image.artifactUrl} />
                <Action.OpenInBrowser title="Open Project in Browser" url={image.projectUrl} />
                <Action
                  title={hideUntagged ? "Show Untagged Images" : "Hide Untagged Images"}
                  icon={Icon.Filter}
                  onAction={() => setHideUntagged((value) => !value)}
                />
                <Action title="Trigger Scan" icon={Icon.MagnifyingGlass} onAction={() => onTriggerScan(image)} />
                <Action
                  title="Delete Tag"
                  style={Action.Style.Destructive}
                  icon={Icon.Trash}
                  onAction={() => onDeleteTag(image)}
                />
                <Action
                  title="Delete Artifact"
                  style={Action.Style.Destructive}
                  icon={Icon.Trash}
                  onAction={() => onDeleteArtifact(image)}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}

function ProjectRepositoriesDetail(props: {
  provider: RegistryProvider;
  providerKind: ProviderKind;
  providerBaseUrl?: string;
  projectName: string;
}) {
  const [searchText, setSearchText] = useState("");
  const { data, isLoading } = useCachedPromise(
    (projectName: string, query: string) => props.provider.listProjectRepositories(projectName, query),
    [props.projectName, searchText],
    {
      keepPreviousData: true,
    },
  );

  const repositories = data ?? [];
  const { data: latestTags } = useCachedPromise(
    async (projectName: string, repositoryNames: string) => {
      const names = repositoryNames ? repositoryNames.split(",").filter(Boolean) : [];
      const result = await Promise.all(
        names.map(async (name) => {
          try {
            const tag = await props.provider.getLatestRepositoryTag(projectName, name);
            return [name, tag] as const;
          } catch {
            return [name, undefined] as const;
          }
        }),
      );
      return Object.fromEntries(result) as Record<string, string | undefined>;
    },
    [props.projectName, repositories.map((repo) => repo.name).join(",")],
    { keepPreviousData: true },
  );

  async function copyLatestTag(repositoryName: string) {
    const tag =
      latestTags?.[repositoryName] ?? (await props.provider.getLatestRepositoryTag(props.projectName, repositoryName));
    if (!tag) {
      await showToast({ style: Toast.Style.Failure, title: "No tag available" });
      return;
    }
    await Clipboard.copy(tag);
    await showToast({ style: Toast.Style.Success, title: `Latest tag copied: ${tag}` });
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search repositories in project"
      throttle
    >
      {repositories.length === 0 ? <List.EmptyView title="No repositories found" /> : null}
      {repositories.map((repository) => (
        <List.Item
          key={repository.id}
          icon={Icon.Box}
          title={repository.name}
          accessories={[
            latestTags?.[repository.name] ? { tag: `latest:${latestTags[repository.name]}` } : { text: "" },
            repository.artifactCount !== undefined ? { text: `${repository.artifactCount} artifacts` } : { text: "" },
            repository.updateTime ? { text: new Date(repository.updateTime).toLocaleDateString() } : { text: "" },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Inspect Artifacts"
                target={
                  <RepositoryArtifactsDetail
                    provider={props.provider}
                    providerKind={props.providerKind}
                    providerBaseUrl={props.providerBaseUrl}
                    projectName={props.projectName}
                    repositoryName={repository.name}
                  />
                }
              />
              <Action.OpenInBrowser title="Open Repository in Browser" url={repository.url} />
              <Action.CopyToClipboard title="Copy Repository Name" content={repository.name} />
              <Action title="Copy Latest Tag" icon={Icon.Clipboard} onAction={() => copyLatestTag(repository.name)} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const { value: favoriteRaw, setValue: setFavoriteRaw } = useLocalStorage<string>("favorite-projects", "[]");

  const favorites = useMemo(() => {
    try {
      return JSON.parse(favoriteRaw ?? "[]") as FavoriteProject[];
    } catch {
      return [] as FavoriteProject[];
    }
  }, [favoriteRaw]);

  const { data, isLoading, revalidate } = useCachedPromise(
    async (query: string, selectedProviderId: string) => {
      const clients = await getProviderClients(selectedProviderId === "all" ? undefined : selectedProviderId);
      const projects = await Promise.all(
        clients.map(async ({ config, client }) => {
          try {
            const found = await client.listProjects(query);
            return found.map((project) => ({ ...project, providerLabel: config.label }));
          } catch {
            return [];
          }
        }),
      );
      return { clients, projects: projects.flat() };
    },
    [searchText, providerFilter],
    { keepPreviousData: true },
  );

  const clients = data?.clients ?? [];
  const projects = data?.projects ?? [];

  async function toggleFavorite(providerId: string, project: string) {
    const exists = favorites.some((entry) => entry.providerId === providerId && entry.name === project);
    const next = exists
      ? favorites.filter((entry) => !(entry.providerId === providerId && entry.name === project))
      : [...favorites, { providerId, name: project }];
    await setFavoriteRaw(JSON.stringify(next));
    await showHUD(exists ? "Removed from favorites" : "Added to favorites");
    await revalidate();
  }

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search projects"
      searchBarAccessory={
        <List.Dropdown tooltip="Filter Provider" value={providerFilter} onChange={setProviderFilter}>
          <List.Dropdown.Item title="All Providers" value="all" />
          {clients.map(({ config }) => (
            <List.Dropdown.Item
              key={config.id}
              title={config.label}
              value={config.id}
              icon={providerIcon(config.kind)}
            />
          ))}
        </List.Dropdown>
      }
      throttle
    >
      {clients.length === 0 ? (
        <List.Item
          title="No providers configured"
          subtitle="Press ⌘N to add one"
          icon={Icon.Plus}
          actions={
            <ActionPanel>
              <Action.Push
                title="Add Provider"
                target={<AddProviderForm onSaved={revalidate} />}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
            </ActionPanel>
          }
        />
      ) : null}

      {projects.map((project) => {
        const favorite = favorites.some(
          (entry) => entry.providerId === project.providerId && entry.name === project.name,
        );
        const providerEntry = clients.find((entry) => entry.config.id === project.providerId);
        const client = providerEntry?.client;
        return (
          <List.Item
            key={project.id}
            icon={favorite ? Icon.Star : Icon.Folder}
            title={project.name}
            subtitle={project.providerLabel}
            accessories={[
              project.repoCount !== undefined ? { text: `${project.repoCount} repos` } : { text: "" },
              favorite ? { icon: { source: Icon.Star, tintColor: Color.Yellow } } : { text: "" },
            ]}
            actions={
              <ActionPanel>
                {client ? (
                  <>
                    <Action.Push
                      title="View Project Repositories"
                      target={
                        <ProjectRepositoriesDetail
                          provider={client}
                          providerKind={providerEntry.config.kind}
                          providerBaseUrl={providerEntry.config.baseUrl}
                          projectName={project.name}
                        />
                      }
                    />
                    <Action.Push
                      title="View Project Members"
                      target={<ProjectMembersDetail provider={client} projectName={project.name} />}
                    />
                  </>
                ) : null}
                <Action.OpenInBrowser title="Open Project in Browser" url={project.projectUrl} />
                <Action
                  title={favorite ? "Remove from Favorites" : "Add to Favorites"}
                  icon={Icon.Star}
                  onAction={() => toggleFavorite(project.providerId, project.name)}
                />
                <Action.CopyToClipboard title="Copy Project Name" content={project.name} />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
