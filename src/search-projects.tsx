import { Action, ActionPanel, Clipboard, Color, Icon, List, showHUD, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo, useState } from "react";
import { AddProviderForm } from "./manage-providers";
import { getProviderClients, providerIcon } from "./providers";
import { RegistryProvider } from "./providers/types";

type FavoriteProject = { providerId: string; name: string };

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

function ProjectRepositoriesDetail(props: { provider: RegistryProvider; projectName: string }) {
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
                  <>
                    <Action.Push
                      title="View Project Repositories"
                      target={<ProjectRepositoriesDetail provider={client} projectName={project.name} />}
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
