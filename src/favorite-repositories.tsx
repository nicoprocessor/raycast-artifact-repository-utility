import { Action, ActionPanel, Clipboard, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useState } from "react";
import { getProviderClients, providerIcon } from "./providers";
import { ProviderKind, RegistryProvider } from "./providers/types";
import { RepositoryArtifactsDetail } from "./search-projects";

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

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const { value: favoriteReposRaw, setValue: setFavoriteReposRaw } = useLocalStorage<string>(
    "favorite-repositories",
    "[]",
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
  const { data: latestTags } = useCachedPromise(
    async (itemsKey: string) => {
      const indexes = itemsKey
        ? itemsKey
            .split("|")
            .filter(Boolean)
            .map((chunk) => {
              const [providerId, projectName, repositoryName] = chunk.split("::");
              return { providerId, projectName, repositoryName };
            })
        : [];
      const clients = await getProviderClients();
      const values = await Promise.all(
        indexes.map(async (item) => {
          const providerEntry = clients.find((client) => client.config.id === item.providerId);
          if (!providerEntry)
            return [`${item.providerId}:${item.projectName}:${item.repositoryName}`, undefined] as const;
          try {
            const tag = await providerEntry.client.getLatestRepositoryTag(item.projectName, item.repositoryName);
            return [`${item.providerId}:${item.projectName}:${item.repositoryName}`, tag] as const;
          } catch {
            return [`${item.providerId}:${item.projectName}:${item.repositoryName}`, undefined] as const;
          }
        }),
      );
      return Object.fromEntries(values) as Record<string, string | undefined>;
    },
    [
      repositories
        .map((item) => `${item.providerId}::${item.projectName}::${item.repositoryName}`)
        .sort()
        .join("|"),
    ],
    { keepPreviousData: true },
  );

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
    const key = `${item.providerId}:${item.projectName}:${item.repositoryName}`;
    const tag =
      latestTags?.[key] ?? (await item.provider.getLatestRepositoryTag(item.projectName, item.repositoryName));
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
              latestTags?.[key] ? { tag: `latest:${latestTags[key]}` } : { text: "" },
              item.artifactCount !== undefined ? { text: `${item.artifactCount} artifacts` } : { text: "" },
              item.updateTime ? { text: new Date(item.updateTime).toLocaleDateString() } : { text: "" },
            ]}
            actions={
              <ActionPanel>
                <Action.Push
                  title="Inspect Artifacts"
                  target={
                    <RepositoryArtifactsDetail
                      provider={item.provider}
                      providerKind={item.providerKind}
                      providerBaseUrl={item.providerBaseUrl}
                      projectName={item.projectName}
                      repositoryName={item.repositoryName}
                    />
                  }
                />
                <Action title="Copy Latest Tag" icon={Icon.Clipboard} onAction={() => copyLatestTag(item)} />
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
    </List>
  );
}
