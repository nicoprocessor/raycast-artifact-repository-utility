import { Action, ActionPanel, Icon, List, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo } from "react";
import { getProviderClients, providerIcon } from "./providers";
import { ProviderKind, RegistryProvider } from "./providers/types";
import { ProjectRepositoriesDetail } from "./search-projects";

type FavoriteProject = { providerId: string; name: string };
type FavoriteProjectItem = {
  id: string;
  providerId: string;
  providerLabel: string;
  name: string;
  repoCount?: number;
  projectUrl: string;
  providerKind: ProviderKind;
  provider: RegistryProvider;
  providerBaseUrl?: string;
};

export default function Command() {
  const { value: favoriteRaw, setValue: setFavoriteRaw } = useLocalStorage<string>("favorite-projects", "[]");

  const favorites = useMemo(() => {
    try {
      return JSON.parse(favoriteRaw ?? "[]") as FavoriteProject[];
    } catch {
      return [] as FavoriteProject[];
    }
  }, [favoriteRaw]);

  const { data, isLoading, revalidate } = useCachedPromise(
    async (rawFavorites: string | undefined) => {
      const parsedFavorites = (() => {
        try {
          return JSON.parse(rawFavorites ?? "[]") as FavoriteProject[];
        } catch {
          return [] as FavoriteProject[];
        }
      })();

      const clients = await getProviderClients();
      const projects = await Promise.all(
        clients.map(async ({ config, client }) => {
          try {
            const listed = await client.listProjects("");
            return listed
              .filter((project) =>
                parsedFavorites.some((fav) => fav.providerId === config.id && fav.name === project.name),
              )
              .map((project) => ({
                ...project,
                providerKind: config.kind,
                provider: client,
                providerBaseUrl: config.baseUrl,
              }));
          } catch {
            return [];
          }
        }),
      );

      return projects.flat() as FavoriteProjectItem[];
    },
    [favoriteRaw],
  );

  async function removeFavorite(providerId: string, name: string) {
    await setFavoriteRaw(
      JSON.stringify(favorites.filter((item) => !(item.providerId === providerId && item.name === name))),
    );
    await showToast({ style: Toast.Style.Success, title: "Removed from favorites", message: name });
    await revalidate();
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Favorite projects">
      {(data ?? []).map((project) => (
        <List.Item
          key={project.id}
          icon={providerIcon(project.providerKind)}
          title={project.name}
          subtitle={project.providerLabel}
          accessories={project.repoCount !== undefined ? [{ text: `${project.repoCount} repos` }] : []}
          actions={
            <ActionPanel>
              <Action.Push
                title="View Project Repositories"
                target={
                  <ProjectRepositoriesDetail
                    providerId={project.providerId}
                    provider={project.provider}
                    providerKind={project.providerKind}
                    providerBaseUrl={project.providerBaseUrl}
                    projectName={project.name}
                  />
                }
              />
              <Action.OpenInBrowser title="Open Project in Browser" url={project.projectUrl} />
              <Action
                title="Remove from Favorites"
                icon={Icon.Trash}
                onAction={() => removeFavorite(project.providerId, project.name)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
