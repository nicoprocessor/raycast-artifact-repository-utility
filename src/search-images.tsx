import { Action, ActionPanel, Alert, Clipboard, Color, confirmAlert, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { AddProviderForm } from "./manage-providers";
import { getProviderClients, providerIcon } from "./providers";
import { getProviderConfigs } from "./providers/storage";
import { RegistryImage, VulnerabilitySummary } from "./providers/types";
import { buildFullArtifactPath } from "./utils/image-reference";
import { useDelayedLoading } from "./utils/loading";
import { formatDateTime, getUserSettings } from "./utils/settings";
import { runInDefaultTerminal } from "./utils/terminal";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function severityBadge(scanStatus: RegistryImage["scanStatus"], summary: VulnerabilitySummary) {
  if (scanStatus === "not-scanned") {
    return { text: "Not scanned", icon: Icon.MagnifyingGlass, color: Color.SecondaryText };
  }
  if (scanStatus === "scanning") {
    return { text: "Scan in progress", icon: Icon.Clock, color: Color.Orange };
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

function latestTagKey(entry: Pick<RegistryImage, "providerId" | "project" | "repositoryName">) {
  return `${entry.providerId}::${entry.project}::${entry.repositoryName}`;
}

function providerFailuresMarkdown(failures: string[]): string {
  if (failures.length === 0) return "# Provider Errors\n\nNo errors.";
  const items = failures.map((failure) => `- ${failure}`).join("\n");
  return `# Provider Errors\n\n${items}`;
}

function providerFailuresAsMarkdownCodeBlock(failures: string[]): string {
  const body = failures.length > 0 ? failures.join("\n") : "No errors.";
  return `## Provider Errors\n\n\`\`\`text\n${body}\n\`\`\``;
}

type SearchImagesResult = {
  images: RegistryImage[];
  providers: Awaited<ReturnType<typeof getProviderClients>>;
  failures: string[];
  activeQuery: string;
};

export default function Command() {
  const settings = getUserSettings();
  const [searchText, setSearchText] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const { data: providerConfigs } = useCachedPromise(getProviderConfigs, []);
  const { value: favoriteReposRaw, setValue: setFavoriteReposRaw } = useLocalStorage<string>(
    "favorite-repositories",
    "[]",
  );
  const { value: lastSearchQueryRaw, setValue: setLastSearchQueryRaw } = useLocalStorage<string>(
    "search-images-last-query",
    "",
  );
  const { value: hideUntaggedRaw, setValue: setHideUntaggedRaw } = useLocalStorage<string>(
    "search-images-hide-untagged",
    "false",
  );
  const hideUntagged = hideUntaggedRaw === "true";

  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (query: string, selectedProviderId: string, lastQuery?: string): Promise<SearchImagesResult> => {
      const effectiveQuery = query.trim() || (lastQuery?.trim() ?? "");
      if (!effectiveQuery)
        return {
          images: [] as RegistryImage[],
          providers: await getProviderClients(),
          failures: [] as string[],
          activeQuery: "",
        };
      const providers = await getProviderClients(selectedProviderId === "all" ? undefined : selectedProviderId);
      const results = await Promise.all(
        providers.map(async ({ config, client }) => {
          try {
            const images = await client.searchImages(effectiveQuery);
            return {
              images: images.map((image) => ({ ...image, providerLabel: config.label })),
              failure: undefined as string | undefined,
            };
          } catch (providerError) {
            const message = providerError instanceof Error ? providerError.message : String(providerError);
            return { images: [] as RegistryImage[], failure: `${config.label}: ${message}` };
          }
        }),
      );

      return {
        images: results
          .flatMap((result) => result.images)
          .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")),
        providers,
        failures: results.map((result) => result.failure).filter((item): item is string => Boolean(item)),
        activeQuery: effectiveQuery,
      };
    },
    [searchText, providerFilter, lastSearchQueryRaw],
    { keepPreviousData: true },
  );

  const providers = useMemo(() => data?.providers ?? [], [data]);
  const images = useMemo(
    () => (data?.images ?? []).filter((image) => (hideUntagged ? image.tag.toLowerCase() !== "untagged" : true)),
    [data, hideUntagged],
  );
  const favoriteRepos = useMemo(() => {
    try {
      return JSON.parse(favoriteReposRaw ?? "[]") as {
        providerId: string;
        projectName: string;
        repositoryName: string;
      }[];
    } catch {
      return [] as { providerId: string; projectName: string; repositoryName: string }[];
    }
  }, [favoriteReposRaw]);
  const failures = useMemo(() => data?.failures ?? [], [data]);
  const activeQuery = useMemo(() => data?.activeQuery ?? "", [data]);
  const hasConfiguredProviders = (providerConfigs?.length ?? 0) > 0;

  useEffect(() => {
    if (providerFilter !== "all" && !providers.some(({ config }) => config.id === providerFilter)) {
      setProviderFilter("all");
    }
  }, [providerFilter, providers]);
  const repositoryEntries = useMemo(() => {
    const unique = new Map<string, Pick<RegistryImage, "providerId" | "project" | "repositoryName">>();
    images.forEach((image) => {
      const entry = { providerId: image.providerId, project: image.project, repositoryName: image.repositoryName };
      unique.set(latestTagKey(entry), entry);
    });
    return Array.from(unique.values());
  }, [images]);
  const repositoryKeyList = useMemo(
    () => repositoryEntries.map((entry) => latestTagKey(entry)).join("|"),
    [repositoryEntries],
  );
  const providersKeyList = useMemo(() => providers.map(({ config }) => config.id).join("|"), [providers]);
  const { data: latestTags, isLoading: isLoadingLatestTags } = useCachedPromise(
    async (entriesKey: string, providersKey: string) => {
      if (!entriesKey || !providersKey) return {} as Record<string, string | undefined>;
      const result = await Promise.all(
        repositoryEntries.map(async (entry) => {
          const provider = providers.find((item) => item.config.id === entry.providerId);
          if (!provider) return [latestTagKey(entry), undefined] as const;
          try {
            const tag = await provider.client.getLatestRepositoryTag(entry.project, entry.repositoryName);
            return [latestTagKey(entry), tag] as const;
          } catch {
            return [latestTagKey(entry), undefined] as const;
          }
        }),
      );
      return Object.fromEntries(result) as Record<string, string | undefined>;
    },
    [repositoryKeyList, providersKeyList],
    { keepPreviousData: true },
  );
  const isLoadingLatestTagsSlow = useDelayedLoading(isLoadingLatestTags && repositoryEntries.length > 0);

  function handleSearchTextChange(text: string) {
    setSearchText(text);
    const trimmed = text.trim();
    if (trimmed) {
      void setLastSearchQueryRaw(trimmed);
    }
  }

  async function runAction(action: () => Promise<void>, loadingTitle: string, doneTitle: string) {
    await showToast({ style: Toast.Style.Animated, title: loadingTitle });
    await action();
    await revalidate();
    await showToast({ style: Toast.Style.Success, title: doneTitle });
  }

  async function onDeleteTag(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete tag ${image.tag}?`,
      message: `${image.providerLabel} · ${image.repository}:${image.tag}`,
      primaryAction: { title: "Delete Tag", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const provider = providers.find((item) => item.config.id === image.providerId);
    if (!provider) return;

    await runAction(
      () => provider.client.deleteTag(image.project, image.repositoryName, image.digest, image.tag),
      "Deleting tag...",
      "Tag deleted",
    );
  }

  async function onDeleteArtifact(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete artifact ${image.digest.slice(0, 16)}...?`,
      message: `${image.providerLabel} · ${image.repository}`,
      primaryAction: { title: "Delete Artifact", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const provider = providers.find((item) => item.config.id === image.providerId);
    if (!provider) return;

    await runAction(
      () => provider.client.deleteArtifact(image.project, image.repositoryName, image.digest),
      "Deleting artifact...",
      "Artifact deleted",
    );
  }

  async function onTriggerScan(image: RegistryImage) {
    const provider = providers.find((item) => item.config.id === image.providerId);
    if (!provider) return;

    await runAction(
      () => provider.client.triggerScan(image.project, image.repositoryName, image.digest),
      "Starting scan...",
      "Scan started",
    );
  }

  async function copyText(content: string, title: string) {
    await Clipboard.copy(content);
    await showToast({ style: Toast.Style.Success, title, message: content });
  }

  async function copyProviderErrorsAsMarkdown() {
    const markdown = providerFailuresAsMarkdownCodeBlock(failures);
    await Clipboard.copy(markdown);
    await showToast({ style: Toast.Style.Success, title: "Provider errors copied as Markdown" });
  }

  async function toggleFavoriteRepository(providerId: string, projectName: string, repositoryName: string) {
    const exists = favoriteRepos.some(
      (entry) =>
        entry.providerId === providerId && entry.projectName === projectName && entry.repositoryName === repositoryName,
    );
    const next = exists
      ? favoriteRepos.filter(
          (entry) =>
            !(
              entry.providerId === providerId &&
              entry.projectName === projectName &&
              entry.repositoryName === repositoryName
            ),
        )
      : [...favoriteRepos, { providerId, projectName, repositoryName }];
    await setFavoriteReposRaw(JSON.stringify(next));
    await showToast({
      style: Toast.Style.Success,
      title: exists ? "Removed from favorite repositories" : "Added to favorite repositories",
      message: `${projectName}/${repositoryName}`,
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

  const providerDropdown = (
    <List.Dropdown tooltip="Filter Provider" value={providerFilter} onChange={setProviderFilter}>
      <List.Dropdown.Item title="All Providers" value="all" />
      {providers.map(({ config }) => (
        <List.Dropdown.Item key={config.id} title={config.label} value={config.id} icon={providerIcon(config.kind)} />
      ))}
    </List.Dropdown>
  );

  return (
    <List
      isLoading={isLoading || isLoadingLatestTagsSlow}
      onSearchTextChange={handleSearchTextChange}
      searchBarPlaceholder="Search tag / image / project / digest"
      searchBarAccessory={providerDropdown}
      throttle
      isShowingDetail
    >
      {error ? <List.EmptyView title="Request failed" description={error.message} icon={Icon.ExclamationMark} /> : null}
      {providers.length === 0 && hasConfiguredProviders ? (
        <List.Item
          title="All providers disabled"
          subtitle="Enable a provider from Manage Providers"
          icon={Icon.Pause}
        />
      ) : null}
      {providers.length === 0 && !hasConfiguredProviders ? (
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
      {!searchText.trim() && providers.length > 0 && !activeQuery ? (
        <List.EmptyView title="Type to search" description="Default search runs across all configured providers" />
      ) : null}
      {searchText.trim() && images.length === 0 && failures.length > 0 ? (
        <List.EmptyView title="Search failed" description={failures.join(" | ")} icon={Icon.ExclamationMark} />
      ) : null}
      {searchText.trim() && failures.length > 0 ? (
        <List.Item
          id="status-provider-failures-image-search"
          title="Some providers failed"
          subtitle={failures.join(" | ")}
          icon={Icon.ExclamationMark}
          detail={
            <List.Item.Detail
              markdown={providerFailuresMarkdown(failures)}
              metadata={
                <List.Item.Detail.Metadata>
                  <List.Item.Detail.Metadata.Label title="Failed Providers" text={String(failures.length)} />
                </List.Item.Detail.Metadata>
              }
            />
          }
          actions={
            <ActionPanel>
              <Action
                title="Copy Provider Errors as Markdown"
                icon={Icon.Clipboard}
                onAction={copyProviderErrorsAsMarkdown}
              />
            </ActionPanel>
          }
        />
      ) : null}
      {searchText.trim() && images.length === 0 && failures.length === 0 && hideUntagged ? (
        <List.EmptyView
          title="No tagged images found"
          description="Disable 'Hide Untagged Images' to include untagged artifacts."
        />
      ) : null}

      {images.map((image) => {
        const severity = severityBadge(image.scanStatus, image.vulnerabilitySummary);
        const provider = providers.find((entry) => entry.config.id === image.providerId);
        const fullArtifactPath = buildFullArtifactPath(
          provider?.config.kind ?? "private-harbor",
          image.repository,
          image.tag,
          provider?.config.baseUrl,
        );
        const latestTag = latestTags?.[latestTagKey(image)];
        const isLatest = latestTag === image.tag;
        const isFavoriteRepository = favoriteRepos.some(
          (entry) =>
            entry.providerId === image.providerId &&
            entry.projectName === image.project &&
            entry.repositoryName === image.repositoryName,
        );
        return (
          <List.Item
            key={image.id}
            icon={providerIcon(provider?.config.kind ?? "private-harbor")}
            title={image.repository}
            subtitle={image.tag}
            accessories={[
              isLatest ? { icon: { source: Icon.ArrowUp, tintColor: Color.Green }, tooltip: "Latest" } : { text: "" },
              { icon: { source: severity.icon, tintColor: severity.color }, tooltip: severity.text },
            ]}
            detail={
              <List.Item.Detail
                markdown={[
                  `# ${image.repository}:${image.tag}`,
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
                  onAction={() => toggleFavoriteRepository(image.providerId, image.project, image.repositoryName)}
                />
                <Action
                  title={hideUntagged ? "Show Untagged Images" : "Hide Untagged Images"}
                  icon={Icon.Filter}
                  onAction={() => setHideUntaggedRaw(String(!hideUntagged))}
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
      {isLoadingLatestTagsSlow ? (
        <List.Item
          id="status-loading-latest-tags"
          title="Updating latest tags..."
          subtitle="Some repositories are still loading. Results are not final yet."
          icon={Icon.Clock}
        />
      ) : null}
    </List>
  );
}
