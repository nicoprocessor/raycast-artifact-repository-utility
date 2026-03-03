import { Action, ActionPanel, Color, Icon, List, showHUD } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo, useState } from "react";
import { AddProviderForm } from "./manage-providers";
import { getProviderClients, providerIcon } from "./providers";
import { RegistryProvider } from "./providers/types";

type FavoriteProject = { providerId: string; name: string };

function membersMarkdown(items: Array<{ username: string; role: string }>): string {
  if (!items.length) return "No members found or endpoint not available for this provider.";
  return ["## Members", ...items.map((member) => `- **${member.username}** — ${member.role}`)].join("\n");
}

function ProjectMembersDetail(props: { provider: RegistryProvider; projectName: string }) {
  const { data, isLoading } = useCachedPromise(
    (projectName: string) => props.provider.listProjectMembers(projectName),
    [props.projectName],
    {
      keepPreviousData: true,
    },
  );

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Project members">
      <List.Item title={props.projectName} detail={<List.Item.Detail markdown={membersMarkdown(data ?? [])} />} />
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
        const client = clients.find((entry) => entry.config.id === project.providerId)?.client;
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
                  <Action.Push
                    title="View Project Members"
                    target={<ProjectMembersDetail provider={client} projectName={project.name} />}
                  />
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
