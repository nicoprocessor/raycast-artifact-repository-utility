import { Action, ActionPanel, Alert, Clipboard, Color, Icon, List, confirmAlert, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { AddProviderForm } from "./manage-providers";
import { getProviderClients, providerIcon } from "./providers";
import { getProviderConfigs } from "./providers/storage";
import {
  ProviderKind,
  RegistryImage,
  RegistryProject,
  RegistryProvider,
  VulnerabilitySummary,
} from "./providers/types";
import { buildFullArtifactPath } from "./utils/image-reference";
import { useDelayedLoading } from "./utils/loading";
import { formatDate, formatDateTime, getUserSettings } from "./utils/settings";
import { runInDefaultTerminal } from "./utils/terminal";

type FavoriteProject = { providerId: string; name: string };
type FavoriteRepository = { providerId: string; projectName: string; repositoryName: string };
type LatestTagCacheEntry = { tag?: string; fetchedAt: number };
type LatestTagCache = Record<string, LatestTagCacheEntry>;

function parseLatestTagCache(raw: string | undefined): LatestTagCache {
  try {
    return JSON.parse(raw ?? "{}") as LatestTagCache;
  } catch {
    return {};
  }
}

function buildRepositoryLatestTagCacheKey(providerId: string, projectName: string, repositoryName: string): string {
  return `${providerId}:${projectName}:${repositoryName}`;
}

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
  return [
    "1. **Critical:** " + summary.critical,
    "2. **High:** " + summary.high,
    "3. **Medium:** " + summary.medium,
    "4. **Low:** " + summary.low,
    "5. **Unknown:** " + summary.unknown,
  ].join("\n");
}

async function copyText(content: string, title: string) {
  await Clipboard.copy(content);
  await showToast({ style: Toast.Style.Success, title, message: content });
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
              <Action
                title="Copy Username"
                icon={Icon.Clipboard}
                onAction={() => copyText(member.username, "Username copied")}
              />
              <Action title="Copy Role" icon={Icon.Clipboard} onAction={() => copyText(member.role, "Role copied")} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}

export function RepositoryArtifactsDetail(props: { providerId: string; projectName: string; repositoryName: string }) {
  const settings = getUserSettings();
  const [searchText, setSearchText] = useState("");
  const [hideUntagged, setHideUntagged] = useState(false);
  const { value: favoriteReposRaw, setValue: setFavoriteReposRaw } = useLocalStorage<string>(
    "favorite-repositories",
    "[]",
  );
  const { data: providerEntry, isLoading: isLoadingProvider } = useCachedPromise(
    async (providerId: string) => {
      const clients = await getProviderClients(providerId);
      return clients[0];
    },
    [props.providerId],
    { keepPreviousData: true },
  );
  const provider = providerEntry?.client;
  const providerConfig = providerEntry?.config;
  const { data, isLoading, revalidate } = useCachedPromise(
    async (providerId: string, projectName: string, repositoryName: string, query: string) => {
      if (!provider) return [] as RegistryImage[];
      return provider.listRepositoryArtifacts(projectName, repositoryName, query);
    },
    [providerEntry?.config.id ?? "", props.projectName, props.repositoryName, searchText],
    {
      keepPreviousData: true,
      execute: Boolean(provider),
    },
  );

  const images = useMemo(
    () => (data ?? []).filter((image) => (hideUntagged ? image.tag.toLowerCase() !== "untagged" : true)),
    [data, hideUntagged],
  );
  const favoriteRepos = useMemo(() => {
    try {
      return JSON.parse(favoriteReposRaw ?? "[]") as FavoriteRepository[];
    } catch {
      return [] as FavoriteRepository[];
    }
  }, [favoriteReposRaw]);
  const isFavoriteRepository = favoriteRepos.some(
    (item) =>
      item.providerId === props.providerId &&
      item.projectName === props.projectName &&
      item.repositoryName === props.repositoryName,
  );
  const { data: latestTag, isLoading: isLoadingLatestTag } = useCachedPromise(
    async (providerId: string, projectName: string, repositoryName: string) => {
      if (!provider) return undefined;
      try {
        return await provider.getLatestRepositoryTag(projectName, repositoryName);
      } catch {
        return undefined;
      }
    },
    [providerEntry?.config.id ?? "", props.projectName, props.repositoryName],
    { keepPreviousData: true, execute: Boolean(provider) },
  );
  const isLoadingLatestTagSlow = useDelayedLoading(isLoadingLatestTag && Boolean(provider));

  async function toggleFavoriteRepository() {
    const exists = favoriteRepos.some(
      (entry) =>
        entry.providerId === props.providerId &&
        entry.projectName === props.projectName &&
        entry.repositoryName === props.repositoryName,
    );
    const next = exists
      ? favoriteRepos.filter(
          (entry) =>
            !(
              entry.providerId === props.providerId &&
              entry.projectName === props.projectName &&
              entry.repositoryName === props.repositoryName
            ),
        )
      : [
          ...favoriteRepos,
          { providerId: props.providerId, projectName: props.projectName, repositoryName: props.repositoryName },
        ];
    await setFavoriteReposRaw(JSON.stringify(next));
    await showToast({
      style: Toast.Style.Success,
      title: exists ? "Removed from favorite repositories" : "Added to favorite repositories",
      message: `${props.projectName}/${props.repositoryName}`,
    });
  }

  async function onPullLocally(fullArtifactPath: string) {
    const pullCommand = `docker pull ${fullArtifactPath}`;
    await showToast({ style: Toast.Style.Animated, title: "Starting local pull...", message: pullCommand });
    await runInDefaultTerminal(pullCommand);
    await showToast({
      style: Toast.Style.Success,
      title: "Docker pull started in your terminal",
      message: pullCommand,
    });
  }

  async function runArtifactAction(action: () => Promise<void>, loadingTitle: string, doneTitle: string) {
    await showToast({ style: Toast.Style.Animated, title: loadingTitle });
    await action();
    await revalidate();
    await showToast({ style: Toast.Style.Success, title: doneTitle });
  }

  async function onDeleteTag(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete tag ${image.tag}?`,
      message: `${image.repository}:${image.tag}`,
      primaryAction: { title: "Delete Tag", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;
    if (!provider) return;
    await runArtifactAction(
      () => provider.deleteTag(image.project, image.repositoryName, image.digest, image.tag),
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
    if (!provider) return;
    await runArtifactAction(
      () => provider.deleteArtifact(image.project, image.repositoryName, image.digest),
      "Deleting artifact...",
      "Artifact deleted",
    );
  }

  async function onTriggerScan(image: RegistryImage) {
    if (!provider) return;
    await runArtifactAction(
      () => provider.triggerScan(image.project, image.repositoryName, image.digest),
      "Starting scan...",
      "Scan started",
    );
  }

  return (
    <List
      isLoading={isLoading || isLoadingProvider || isLoadingLatestTagSlow}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search artifacts in repository"
      throttle
      isShowingDetail
    >
      {!provider ? (
        <List.EmptyView title="Provider unavailable" description="Enable the provider or update its configuration." />
      ) : null}
      {images.length === 0 ? <List.EmptyView title="No artifacts found" /> : null}
      {images.map((image) => {
        const severity = severityBadge(image.scanStatus, image.vulnerabilitySummary);
        const fullArtifactPath = buildFullArtifactPath(
          providerConfig?.kind ?? "private-harbor",
          image.repository,
          image.tag,
          providerConfig?.baseUrl,
        );
        const isLatest = latestTag === image.tag;
        return (
          <List.Item
            key={image.id}
            icon={Icon.Box}
            title={image.tag}
            accessories={[
              isLatest ? { icon: { source: Icon.ArrowUp, tintColor: Color.Green }, tooltip: "Latest" } : { text: "" },
              { icon: { source: severity.icon, tintColor: severity.color }, tooltip: severity.text },
            ]}
            detail={
              <List.Item.Detail
                markdown={[
                  `# ${image.tag}`,
                  `- **Repository:** ${image.repository}`,
                  `- **Provider:** ${image.providerLabel}`,
                  `- **Project:** ${image.project}`,
                  `- **Size:** ${formatBytes(image.sizeBytes)}`,
                  `- **Platforms:** ${image.platforms?.length ? image.platforms.join(", ") : "-"}`,
                  `- **Pushed At:** ${formatDateTime(image.pushedAt, settings.dateFormat)}`,
                  `- **Scan Status:** ${image.scanStatus}`,
                  "",
                  "## Vulnerabilities",
                  vulnDetail(image.vulnerabilitySummary),
                ].join("\n")}
              />
            }
            actions={
              <ActionPanel>
                <Action title="Copy Tag" icon={Icon.Clipboard} onAction={() => copyText(image.tag, "Tag copied")} />
                <Action
                  title="Copy Full Artifact Path"
                  icon={Icon.Clipboard}
                  shortcut={{ modifiers: ["cmd"], key: "enter" }}
                  onAction={() => copyText(fullArtifactPath, "Full artifact path copied")}
                />
                <Action
                  title="Copy Digest"
                  icon={Icon.Clipboard}
                  onAction={() => copyText(image.digest, "Digest copied")}
                />
                <Action
                  title="Copy Artifact URL"
                  icon={Icon.Clipboard}
                  onAction={() => copyText(image.artifactUrl, "Artifact URL copied")}
                />
                <Action
                  title="Copy Project URL"
                  icon={Icon.Clipboard}
                  onAction={() => copyText(image.projectUrl, "Project URL copied")}
                />
                <Action
                  title="Pull Locally (Docker)"
                  icon={Icon.Download}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                  onAction={() => onPullLocally(fullArtifactPath)}
                />
                <Action.OpenInBrowser title="Open Artifact in Browser" url={image.artifactUrl} />
                <Action.OpenInBrowser title="Open Project in Browser" url={image.projectUrl} />
                <Action
                  title={isFavoriteRepository ? "Remove from Favorite Repositories" : "Add to Favorite Repositories"}
                  icon={Icon.Star}
                  onAction={toggleFavoriteRepository}
                />
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
      {isLoadingLatestTagSlow ? (
        <List.Item
          id="status-loading-latest-tag"
          title="Updating latest tag..."
          subtitle="Repository metadata is still loading. Results are not final yet."
          icon={Icon.Clock}
        />
      ) : null}
    </List>
  );
}

export function ProjectRepositoriesDetail(props: {
  providerId: string;
  provider: RegistryProvider;
  providerKind: ProviderKind;
  providerBaseUrl?: string;
  projectName: string;
}) {
  const settings = getUserSettings();
  const [searchText, setSearchText] = useState("");
  const { value: favoriteReposRaw, setValue: setFavoriteReposRaw } = useLocalStorage<string>(
    "favorite-repositories",
    "[]",
  );
  const { value: latestTagCacheRaw, setValue: setLatestTagCacheRaw } = useLocalStorage<string>(
    "project-repositories-latest-tag-cache",
    "{}",
  );
  const favoriteRepos = useMemo(() => {
    try {
      return JSON.parse(favoriteReposRaw ?? "[]") as FavoriteRepository[];
    } catch {
      return [] as FavoriteRepository[];
    }
  }, [favoriteReposRaw]);
  const { data, isLoading } = useCachedPromise(
    (projectName: string, query: string) => props.provider.listProjectRepositories(projectName, query),
    [props.projectName, searchText],
    {
      keepPreviousData: true,
    },
  );

  const repositories = data ?? [];
  const repositoriesKey = useMemo(
    () =>
      repositories
        .map((repo) => repo.name)
        .sort()
        .join(","),
    [repositories],
  );
  const cachedLatestTags = useMemo(() => {
    const cache = parseLatestTagCache(latestTagCacheRaw);
    const now = Date.now();
    return Object.fromEntries(
      repositories.map((repository) => {
        const cacheKey = buildRepositoryLatestTagCacheKey(props.providerId, props.projectName, repository.name);
        const entry = cache[cacheKey];
        const isFresh = Boolean(entry) && now - entry.fetchedAt <= settings.latestTagCacheTtlMs;
        return [repository.name, isFresh ? entry?.tag : undefined] as const;
      }),
    ) as Record<string, string | undefined>;
  }, [latestTagCacheRaw, props.projectName, props.providerId, repositories, settings.latestTagCacheTtlMs]);
  const { data: latestTags, isLoading: isLoadingLatestTags } = useCachedPromise(
    async (
      providerId: string,
      projectName: string,
      repositoryNames: string,
      cacheRaw: string | undefined,
      latestTagCacheTtlMs: number,
    ) => {
      const names = repositoryNames ? repositoryNames.split(",").filter(Boolean) : [];
      const now = Date.now();
      const cache = parseLatestTagCache(cacheRaw);
      let cacheChanged = false;
      const result = await Promise.all(
        names.map(async (name) => {
          const cacheKey = buildRepositoryLatestTagCacheKey(providerId, projectName, name);
          const cached = cache[cacheKey];
          if (cached && now - cached.fetchedAt <= latestTagCacheTtlMs) {
            return [name, cached.tag] as const;
          }

          try {
            const tag = await props.provider.getLatestRepositoryTag(projectName, name);
            cache[cacheKey] = { tag, fetchedAt: Date.now() };
            cacheChanged = true;
            return [name, tag] as const;
          } catch {
            cache[cacheKey] = { tag: undefined, fetchedAt: Date.now() };
            cacheChanged = true;
            return [name, undefined] as const;
          }
        }),
      );
      if (cacheChanged) {
        await setLatestTagCacheRaw(JSON.stringify(cache));
      }
      return Object.fromEntries(result) as Record<string, string | undefined>;
    },
    [props.providerId, props.projectName, repositoriesKey, latestTagCacheRaw, settings.latestTagCacheTtlMs],
    { keepPreviousData: true },
  );
  const displayedLatestTags = latestTags ?? cachedLatestTags;

  async function copyLatestTag(repositoryName: string) {
    const tag =
      displayedLatestTags[repositoryName] ??
      (await props.provider.getLatestRepositoryTag(props.projectName, repositoryName));
    if (!tag) {
      await showToast({ style: Toast.Style.Failure, title: "No tag available" });
      return;
    }
    await Clipboard.copy(tag);
    await showToast({ style: Toast.Style.Success, title: `Latest tag copied: ${tag}` });
  }

  async function toggleFavoriteRepository(repositoryName: string) {
    const exists = favoriteRepos.some(
      (item) =>
        item.providerId === props.providerId &&
        item.projectName === props.projectName &&
        item.repositoryName === repositoryName,
    );
    const next = exists
      ? favoriteRepos.filter(
          (item) =>
            !(
              item.providerId === props.providerId &&
              item.projectName === props.projectName &&
              item.repositoryName === repositoryName
            ),
        )
      : [...favoriteRepos, { providerId: props.providerId, projectName: props.projectName, repositoryName }];
    await setFavoriteReposRaw(JSON.stringify(next));
    await showToast({
      style: Toast.Style.Success,
      title: exists ? "Removed from favorite repositories" : "Added to favorite repositories",
      message: `${props.projectName}/${repositoryName}`,
    });
  }

  async function refreshLatestTags() {
    const cache = parseLatestTagCache(latestTagCacheRaw);
    const prefix = `${props.providerId}:${props.projectName}:`;
    const trimmed = Object.fromEntries(Object.entries(cache).filter(([key]) => !key.startsWith(prefix)));
    await showToast({ style: Toast.Style.Animated, title: "Refreshing latest tags..." });
    await setLatestTagCacheRaw(JSON.stringify(trimmed));
    await showToast({
      style: Toast.Style.Success,
      title: "Latest tag cache cleared",
      message: "Refreshing repositories in this project",
    });
  }

  return (
    <List
      isLoading={isLoading || (isLoadingLatestTags && repositories.length > 0)}
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
            displayedLatestTags[repository.name]
              ? {
                  tag: { value: displayedLatestTags[repository.name] ?? "", color: Color.Green },
                  tooltip: "Latest tag",
                }
              : isLoadingLatestTags
                ? { icon: { source: Icon.Clock, tintColor: Color.SecondaryText }, tooltip: "Refreshing latest tag" }
                : { text: "" },
            repository.artifactCount !== undefined ? { text: `${repository.artifactCount} artifacts` } : { text: "" },
            repository.updateTime ? { text: formatDate(repository.updateTime, settings.dateFormat) } : { text: "" },
            favoriteRepos.some(
              (item) =>
                item.providerId === props.providerId &&
                item.projectName === props.projectName &&
                item.repositoryName === repository.name,
            )
              ? { icon: { source: Icon.Star, tintColor: Color.Yellow } }
              : { text: "" },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Inspect Artifacts"
                target={
                  <RepositoryArtifactsDetail
                    providerId={props.providerId}
                    projectName={props.projectName}
                    repositoryName={repository.name}
                  />
                }
              />
              <Action.OpenInBrowser title="Open Repository in Browser" url={repository.url} />
              <Action
                title="Copy Repository Name"
                icon={Icon.Clipboard}
                onAction={() => copyText(repository.name, "Repository name copied")}
              />
              <Action title="Copy Latest Tag" icon={Icon.Clipboard} onAction={() => copyLatestTag(repository.name)} />
              <Action
                title="Refresh Latest Tags"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={refreshLatestTags}
              />
              <Action
                title={
                  favoriteRepos.some(
                    (item) =>
                      item.providerId === props.providerId &&
                      item.projectName === props.projectName &&
                      item.repositoryName === repository.name,
                  )
                    ? "Remove from Favorite Repositories"
                    : "Add to Favorite Repositories"
                }
                icon={Icon.Star}
                onAction={() => toggleFavoriteRepository(repository.name)}
              />
            </ActionPanel>
          }
        />
      ))}
      {isLoadingLatestTags && repositories.length > 0 ? (
        <List.Item
          id="status-loading-project-repositories-latest-tags"
          title="Updating latest tags..."
          subtitle="Some repositories are still loading. Results are not final yet."
          icon={Icon.Clock}
          actions={
            <ActionPanel>
              <Action
                title="Refresh Latest Tags"
                icon={Icon.ArrowClockwise}
                shortcut={{ modifiers: ["cmd"], key: "r" }}
                onAction={refreshLatestTags}
              />
            </ActionPanel>
          }
        />
      ) : null}
    </List>
  );
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const { value: favoriteRaw, setValue: setFavoriteRaw } = useLocalStorage<string>("favorite-projects", "[]");
  const { data: providerConfigs } = useCachedPromise(getProviderConfigs, []);

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
      const projectsByProvider = await Promise.all(
        clients.map(async ({ config, client }) => {
          try {
            const found = await client.listProjects(query);
            return {
              projects: found.map((project) => ({ ...project, providerLabel: config.label })),
              failure: undefined as string | undefined,
            };
          } catch (providerError) {
            const message = providerError instanceof Error ? providerError.message : String(providerError);
            return { projects: [] as RegistryProject[], failure: `${config.label}: ${message}` };
          }
        }),
      );
      return {
        clients,
        projects: projectsByProvider.flatMap((entry) => entry.projects),
        failures: projectsByProvider.map((entry) => entry.failure).filter((item): item is string => Boolean(item)),
      };
    },
    [searchText, providerFilter],
    { keepPreviousData: true },
  );

  const clients = data?.clients ?? [];
  const projects = data?.projects ?? [];
  const failures = data?.failures ?? [];
  const hasConfiguredProviders = (providerConfigs?.length ?? 0) > 0;

  useEffect(() => {
    if (providerFilter !== "all" && !clients.some(({ config }) => config.id === providerFilter)) {
      setProviderFilter("all");
    }
  }, [providerFilter, clients]);

  async function toggleFavorite(providerId: string, project: string) {
    const exists = favorites.some((entry) => entry.providerId === providerId && entry.name === project);
    const next = exists
      ? favorites.filter((entry) => !(entry.providerId === providerId && entry.name === project))
      : [...favorites, { providerId, name: project }];
    await setFavoriteRaw(JSON.stringify(next));
    await showToast({
      style: Toast.Style.Success,
      title: exists ? "Removed from favorites" : "Added to favorites",
      message: project,
    });
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
      {clients.length === 0 && hasConfiguredProviders ? (
        <List.Item
          title="All providers disabled"
          subtitle="Enable a provider from Manage Providers"
          icon={Icon.Pause}
        />
      ) : null}
      {clients.length === 0 && !hasConfiguredProviders ? (
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
      {failures.length > 0 ? (
        <List.Item
          id="status-provider-failures-project-search"
          title="Some providers failed"
          subtitle={failures.join(" | ")}
          icon={Icon.ExclamationMark}
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
              favorite ? { icon: { source: Icon.Star, tintColor: Color.Yellow }, tooltip: "Favorite" } : { text: "" },
            ]}
            actions={
              <ActionPanel>
                {client ? (
                  <>
                    <Action.Push
                      title="View Project Repositories"
                      target={
                        <ProjectRepositoriesDetail
                          providerId={providerEntry.config.id}
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
                <Action
                  title="Copy Project Name"
                  icon={Icon.Clipboard}
                  onAction={() => copyText(project.name, "Project name copied")}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
