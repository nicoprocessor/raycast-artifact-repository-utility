import { Action, ActionPanel, Clipboard, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo, useState } from "react";
import { getProviderClients, providerIcon } from "./providers";
import { ProviderKind, RegistryProvider } from "./providers/types";
import { RepositoryArtifactsDetail } from "./search-projects";
import { buildFullArtifactPath } from "./utils/image-reference";
import { formatDate, getUserSettings } from "./utils/settings";
import { runInDefaultTerminal } from "./utils/terminal";

type FavoriteRepository = { providerId: string; projectName: string; repositoryName: string };
type FavoriteRepositoryItem = FavoriteRepository & {
  id: string;
  providerLabel: string;
  providerKind: ProviderKind;
  providerBaseUrl?: string;
  provider: RegistryProvider;
  repositoryUrl?: string;
  artifactCount?: number;
  updateTime?: string;
};

type LatestTagCacheEntry = {
  tag?: string;
  fetchedAt: number;
};

type LatestTagCache = Record<string, LatestTagCacheEntry>;

function parseLatestTagCache(raw: string | undefined): LatestTagCache {
  try {
    return JSON.parse(raw ?? "{}") as LatestTagCache;
  } catch {
    return {};
  }
}

async function copyText(content: string, title: string) {
  await Clipboard.copy(content);
  await showToast({ style: Toast.Style.Success, title, message: content });
}

function supportsGetLatestRepositoryTag(provider: RegistryProvider): boolean {
  return typeof provider.getLatestRepositoryTag === "function";
}

function supportsListRepositoryArtifacts(provider: RegistryProvider): boolean {
  return typeof provider.listRepositoryArtifacts === "function";
}

export default function Command() {
  const settings = getUserSettings();
  const [searchText, setSearchText] = useState("");
  const { value: favoriteReposRaw, setValue: setFavoriteReposRaw } = useLocalStorage<string>(
    "favorite-repositories",
    "[]",
  );
  const { value: latestTagCacheRaw, setValue: setLatestTagCacheRaw } = useLocalStorage<string>(
    "favorite-repositories-latest-tag-cache",
    "{}",
  );

  const { data, isLoading, revalidate } = useCachedPromise(
    async (raw: string | undefined, query: string) => {
      const favorites = (() => {
        try {
          return JSON.parse(raw ?? "[]") as FavoriteRepository[];
        } catch {
          return [] as FavoriteRepository[];
        }
      })();

      const clients = await getProviderClients();
      const entries = await Promise.all(
        favorites.map(async (favorite) => {
          const providerEntry = clients.find((item) => item.config.id === favorite.providerId);
          if (!providerEntry) return undefined;

          let repositoryUrl: string | undefined;
          let artifactCount: number | undefined;
          let updateTime: string | undefined;
          try {
            const repositories = await providerEntry.client.listProjectRepositories(
              favorite.projectName,
              favorite.repositoryName,
            );
            const matched = repositories.find((repo) => repo.name === favorite.repositoryName);
            repositoryUrl = matched?.url;
            artifactCount = matched?.artifactCount;
            updateTime = matched?.updateTime;
          } catch {
            // keep fallback values
          }

          const haystack =
            `${providerEntry.config.label} ${favorite.projectName} ${favorite.repositoryName}`.toLowerCase();
          if (query.trim() && !haystack.includes(query.toLowerCase())) return undefined;

          return {
            id: `${favorite.providerId}:${favorite.projectName}:${favorite.repositoryName}`,
            ...favorite,
            providerLabel: providerEntry.config.label,
            providerKind: providerEntry.config.kind,
            providerBaseUrl: providerEntry.config.baseUrl,
            provider: providerEntry.client,
            repositoryUrl,
            artifactCount,
            updateTime,
          } as FavoriteRepositoryItem;
        }),
      );

      return entries.filter((item): item is FavoriteRepositoryItem => Boolean(item));
    },
    [favoriteReposRaw, searchText],
    { keepPreviousData: true },
  );

  const repositories = data ?? [];
  const repositoriesKey = useMemo(
    () =>
      repositories
        .map((item) => `${item.providerId}::${item.projectName}::${item.repositoryName}`)
        .sort()
        .join("|"),
    [repositories],
  );
  const cachedLatestTags = useMemo(() => {
    const cache = parseLatestTagCache(latestTagCacheRaw);
    const now = Date.now();
    return Object.fromEntries(
      repositories.map((item) => {
        const key = `${item.providerId}:${item.projectName}:${item.repositoryName}`;
        const entry = cache[key];
        const isFresh = Boolean(entry) && now - entry.fetchedAt <= settings.latestTagCacheTtlMs;
        return [key, isFresh ? entry?.tag : undefined] as const;
      }),
    ) as Record<string, string | undefined>;
  }, [latestTagCacheRaw, repositories, settings.latestTagCacheTtlMs]);
  const { data: latestTags, isLoading: isLoadingLatestTags } = useCachedPromise(
    async (itemsKey: string, cacheRaw: string | undefined, latestTagCacheTtlMs: number) => {
      const indexes = itemsKey
        ? itemsKey
            .split("|")
            .filter(Boolean)
            .map((chunk) => {
              const [providerId, projectName, repositoryName] = chunk.split("::");
              return { providerId, projectName, repositoryName };
            })
        : [];
      const now = Date.now();
      const cache = parseLatestTagCache(cacheRaw);
      let cacheChanged = false;
      const clients = await getProviderClients();
      const values = await Promise.all(
        indexes.map(async (item) => {
          const key = `${item.providerId}:${item.projectName}:${item.repositoryName}`;
          const cached = cache[key];
          if (cached && now - cached.fetchedAt <= latestTagCacheTtlMs) {
            return [key, cached.tag] as const;
          }

          const providerEntry = clients.find((client) => client.config.id === item.providerId);
          if (!providerEntry) {
            cache[key] = { tag: undefined, fetchedAt: Date.now() };
            cacheChanged = true;
            return [key, undefined] as const;
          }

          try {
            const tag = await providerEntry.client.getLatestRepositoryTag(item.projectName, item.repositoryName);
            cache[key] = { tag, fetchedAt: Date.now() };
            cacheChanged = true;
            return [key, tag] as const;
          } catch {
            cache[key] = { tag: undefined, fetchedAt: Date.now() };
            cacheChanged = true;
            return [key, undefined] as const;
          }
        }),
      );
      if (cacheChanged) {
        await setLatestTagCacheRaw(JSON.stringify(cache));
      }
      return Object.fromEntries(values) as Record<string, string | undefined>;
    },
    [repositoriesKey, latestTagCacheRaw, settings.latestTagCacheTtlMs],
    { keepPreviousData: true },
  );
  const displayedLatestTags = latestTags ?? cachedLatestTags;

  async function removeFavorite(item: FavoriteRepositoryItem) {
    const current = (() => {
      try {
        return JSON.parse(favoriteReposRaw ?? "[]") as FavoriteRepository[];
      } catch {
        return [] as FavoriteRepository[];
      }
    })();
    const next = current.filter(
      (entry) =>
        !(
          entry.providerId === item.providerId &&
          entry.projectName === item.projectName &&
          entry.repositoryName === item.repositoryName
        ),
    );
    await setFavoriteReposRaw(JSON.stringify(next));
    await showToast({
      style: Toast.Style.Success,
      title: "Removed from favorite repositories",
      message: `${item.projectName}/${item.repositoryName}`,
    });
    await revalidate();
  }

  async function copyLatestTag(item: FavoriteRepositoryItem) {
    if (!supportsGetLatestRepositoryTag(item.provider)) {
      await showToast({ style: Toast.Style.Failure, title: "Latest tag is not supported by this provider" });
      return;
    }
    const key = `${item.providerId}:${item.projectName}:${item.repositoryName}`;
    const tag =
      displayedLatestTags[key] ?? (await item.provider.getLatestRepositoryTag(item.projectName, item.repositoryName));
    if (!tag) {
      await showToast({ style: Toast.Style.Failure, title: "No tag available" });
      return;
    }
    await Clipboard.copy(tag);
    await showToast({ style: Toast.Style.Success, title: `Latest tag copied: ${tag}` });
  }

  async function resolveLatestArtifact(item: FavoriteRepositoryItem) {
    if (!supportsGetLatestRepositoryTag(item.provider) || !supportsListRepositoryArtifacts(item.provider)) {
      return undefined;
    }
    const key = `${item.providerId}:${item.projectName}:${item.repositoryName}`;
    const tag =
      displayedLatestTags[key] ?? (await item.provider.getLatestRepositoryTag(item.projectName, item.repositoryName));
    if (!tag) return undefined;

    const repositoryPath = `${item.projectName}/${item.repositoryName}`;
    const fullArtifactPath = buildFullArtifactPath(item.providerKind, repositoryPath, tag, item.providerBaseUrl);

    try {
      const images = await item.provider.listRepositoryArtifacts(item.projectName, item.repositoryName, tag);
      const latestImage = images.find((image) => image.tag === tag) ?? images[0];
      return {
        tag,
        fullArtifactPath,
        digest: latestImage?.digest,
        artifactUrl: latestImage?.artifactUrl,
        projectUrl: latestImage?.projectUrl,
      };
    } catch {
      return { tag, fullArtifactPath };
    }
  }

  async function copyLatestArtifactPath(item: FavoriteRepositoryItem) {
    const latest = await resolveLatestArtifact(item);
    if (!latest) {
      await showToast({ style: Toast.Style.Failure, title: "No latest artifact available" });
      return;
    }
    await copyText(latest.fullArtifactPath, "Latest full artifact path copied");
  }

  async function copyLatestArtifactUrl(item: FavoriteRepositoryItem) {
    const latest = await resolveLatestArtifact(item);
    if (!latest?.artifactUrl) {
      await showToast({ style: Toast.Style.Failure, title: "No latest artifact URL available" });
      return;
    }
    await copyText(latest.artifactUrl, "Latest artifact URL copied");
  }

  async function copyLatestProjectUrl(item: FavoriteRepositoryItem) {
    const latest = await resolveLatestArtifact(item);
    if (!latest?.projectUrl) {
      await showToast({ style: Toast.Style.Failure, title: "No latest project URL available" });
      return;
    }
    await copyText(latest.projectUrl, "Latest project URL copied");
  }

  async function copyLatestDigest(item: FavoriteRepositoryItem) {
    const latest = await resolveLatestArtifact(item);
    if (!latest?.digest) {
      await showToast({ style: Toast.Style.Failure, title: "No latest digest available" });
      return;
    }
    await copyText(latest.digest, "Latest digest copied");
  }

  async function pullLatestLocally(item: FavoriteRepositoryItem) {
    const latest = await resolveLatestArtifact(item);
    if (!latest) {
      await showToast({ style: Toast.Style.Failure, title: "No latest artifact available" });
      return;
    }
    await showToast({
      style: Toast.Style.Animated,
      title: "Starting local pull...",
      message: `docker pull ${latest.fullArtifactPath}`,
    });
    await runInDefaultTerminal(`docker pull ${latest.fullArtifactPath}`);
    await showToast({
      style: Toast.Style.Success,
      title: "Docker pull started in your terminal",
      message: latest.fullArtifactPath,
    });
  }

  async function refreshLatestTags() {
    await showToast({ style: Toast.Style.Animated, title: "Refreshing latest tags..." });
    await setLatestTagCacheRaw("{}");
    await showToast({
      style: Toast.Style.Success,
      title: "Latest tag cache cleared",
      message: "Refreshing favorite repositories",
    });
  }

  return (
    <List
      isLoading={isLoading || (isLoadingLatestTags && repositories.length > 0)}
      searchBarPlaceholder="Favorite repositories"
      onSearchTextChange={setSearchText}
      throttle
    >
      {repositories.length === 0 ? <List.EmptyView title="No favorite repositories" /> : null}
      {repositories.map((item) => {
        const key = `${item.providerId}:${item.projectName}:${item.repositoryName}`;
        return (
          <List.Item
            key={item.id}
            icon={providerIcon(item.providerKind)}
            title={item.repositoryName}
            subtitle={`${item.projectName} · ${item.providerLabel}`}
            accessories={[
              displayedLatestTags[key]
                ? { tag: { value: displayedLatestTags[key] ?? "", color: Color.Green }, tooltip: "Latest tag" }
                : !supportsGetLatestRepositoryTag(item.provider)
                ? {
                    icon: { source: Icon.ExclamationMark, tintColor: Color.SecondaryText },
                    tooltip: "Latest tag unavailable",
                  }
                : isLoadingLatestTags
                ? { icon: { source: Icon.Clock, tintColor: Color.SecondaryText }, tooltip: "Refreshing latest tag" }
                : { text: "" },
              item.artifactCount !== undefined ? { text: `${item.artifactCount} artifacts` } : { text: "" },
              item.updateTime ? { text: formatDate(item.updateTime, settings.dateFormat) } : { text: "" },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Inspect Artifacts"
                  target={
                    <RepositoryArtifactsDetail
                      providerId={item.providerId}
                      projectName={item.projectName}
                      repositoryName={item.repositoryName}
                    />
                  }
                />
                <Action title="Copy Latest Tag" icon={Icon.Clipboard} onAction={() => copyLatestTag(item)} />
                <Action
                  title="Copy Latest Full Artifact Path"
                  icon={Icon.Clipboard}
                  shortcut={{ modifiers: ["cmd"], key: "enter" }}
                  onAction={() => copyLatestArtifactPath(item)}
                />
                <Action title="Copy Latest Digest" icon={Icon.Clipboard} onAction={() => copyLatestDigest(item)} />
                <Action
                  title="Copy Latest Artifact URL"
                  icon={Icon.Clipboard}
                  onAction={() => copyLatestArtifactUrl(item)}
                />
                <Action
                  title="Copy Latest Project URL"
                  icon={Icon.Clipboard}
                  onAction={() => copyLatestProjectUrl(item)}
                />
                <Action
                  title="Pull Latest Locally (Docker)"
                  icon={Icon.Download}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "enter" }}
                  onAction={() => pullLatestLocally(item)}
                />
                <Action
                  title="Refresh Latest Tags"
                  icon={Icon.ArrowClockwise}
                  shortcut={{ modifiers: ["cmd"], key: "r" }}
                  onAction={refreshLatestTags}
                />
                {item.repositoryUrl ? (
                  <Action.OpenInBrowser title="Open Repository in Browser" url={item.repositoryUrl} />
                ) : null}
                <Action
                  title="Remove from Favorite Repositories"
                  icon={Icon.Trash}
                  onAction={() => removeFavorite(item)}
                />
              </ActionPanel>
            }
          />
        );
      })}
      {isLoadingLatestTags && repositories.length > 0 ? (
        <List.Item
          id="status-loading-favorite-repositories-latest-tags"
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
