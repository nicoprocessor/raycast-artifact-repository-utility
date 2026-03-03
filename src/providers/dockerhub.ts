import fetch from "node-fetch";
import {
  ProviderConfig,
  RegistryImage,
  RegistryProject,
  RegistryProjectMember,
  RegistryRepository,
  RegistryProvider,
  VulnerabilitySummary,
} from "./types";

type DockerRepository = {
  namespace: string;
  name: string;
  last_updated?: string;
};

type DockerTag = {
  name: string;
  last_updated?: string;
  digest?: string;
  full_size?: number;
  images?: Array<{ digest?: string; size?: number }>;
};

const EMPTY_VULNERABILITY: VulnerabilitySummary = {
  unknown: 0,
  none: 0,
  low: 0,
  medium: 0,
  high: 0,
  critical: 0,
};

export class DockerHubProvider implements RegistryProvider {
  private token?: string;

  constructor(private readonly config: ProviderConfig) {}

  async searchImages(query: string): Promise<RegistryImage[]> {
    if (!query.trim()) return [];

    const projects = await this.listProjects("");
    const source = projects
      .filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
      .slice(0, 5)
      .map((project) => project.name);

    const repositories = source.length ? source : [this.config.defaultNamespace ?? this.config.username ?? "library"];
    const images = await Promise.all(repositories.map((namespace) => this.searchNamespace(namespace, query)));
    return images.flat().sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? ""));
  }

  async listProjects(query = ""): Promise<RegistryProject[]> {
    const namespace = this.config.defaultNamespace ?? this.config.username;
    if (!namespace) return [];

    const response = await this.fetchJson<{ count?: number }>(
      `/v2/repositories/${encodeURIComponent(namespace)}/?page_size=1`,
    );

    return [
      {
        id: `${this.config.id}:${namespace}`,
        providerId: this.config.id,
        providerLabel: this.config.label,
        name: namespace,
        repoCount: response.count,
        projectUrl: `https://hub.docker.com/u/${encodeURIComponent(namespace)}`,
      },
    ].filter((project) => project.name.toLowerCase().includes(query.toLowerCase()));
  }

  async listProjectMembers(projectName: string): Promise<RegistryProjectMember[]> {
    try {
      await this.ensureToken();
      const members = await this.fetchJson<{ results?: Array<{ id: number; username: string }> }>(
        `/v2/orgs/${encodeURIComponent(projectName)}/members?page_size=100`,
      );

      return (members.results ?? []).map((member) => ({
        id: String(member.id),
        username: member.username,
        role: "member",
      }));
    } catch {
      return [];
    }
  }

  async listProjectRepositories(projectName: string, query = ""): Promise<RegistryRepository[]> {
    const repositories = await this.fetchJson<{ results?: DockerRepository[] }>(
      `/v2/repositories/${encodeURIComponent(projectName)}/?page_size=100&name=${encodeURIComponent(query)}`,
    );

    return (repositories.results ?? []).map((repo) => ({
      id: `${this.config.id}:${projectName}:${repo.name}`,
      name: repo.name,
      updateTime: repo.last_updated,
      url: `https://hub.docker.com/r/${encodeURIComponent(projectName)}/${encodeURIComponent(repo.name)}`,
    }));
  }

  async deleteTag(): Promise<void> {
    throw new Error("Docker Hub tag deletion is not enabled in this MVP provider.");
  }

  async deleteArtifact(): Promise<void> {
    throw new Error("Docker Hub artifact deletion is not enabled in this MVP provider.");
  }

  async triggerScan(): Promise<void> {
    throw new Error("Docker Hub scan trigger is not available in this MVP provider.");
  }

  private async searchNamespace(namespace: string, query: string): Promise<RegistryImage[]> {
    const repositories = await this.fetchJson<{ results?: DockerRepository[] }>(
      `/v2/repositories/${encodeURIComponent(namespace)}/?page_size=100&name=${encodeURIComponent(query)}`,
    );

    const images = await Promise.all(
      (repositories.results ?? []).slice(0, 10).map(async (repository) => {
        const tagsResponse = await this.fetchJson<{ results?: DockerTag[] }>(
          `/v2/repositories/${encodeURIComponent(repository.namespace)}/${encodeURIComponent(
            repository.name,
          )}/tags?page_size=50&name=${encodeURIComponent(query)}`,
        );
        const tags = tagsResponse.results ?? [];

        return tags.map((tag) => {
          const digest = tag.digest ?? tag.images?.[0]?.digest ?? "-";
          const size = tag.full_size ?? tag.images?.[0]?.size;
          const repoFullName = `${repository.namespace}/${repository.name}`;

          return {
            id: `${this.config.id}:${repoFullName}:${tag.name}`,
            providerId: this.config.id,
            providerLabel: this.config.label,
            project: repository.namespace,
            repository: repoFullName,
            repositoryName: repository.name,
            tag: tag.name,
            digest,
            pushedAt: tag.last_updated,
            sizeBytes: size,
            scanStatus: "not-scanned" as const,
            vulnerabilitySummary: { ...EMPTY_VULNERABILITY },
            projectUrl: `https://hub.docker.com/r/${encodeURIComponent(repository.namespace)}/${encodeURIComponent(
              repository.name,
            )}`,
            artifactUrl: `https://hub.docker.com/r/${encodeURIComponent(repository.namespace)}/${encodeURIComponent(
              repository.name,
            )}/tags?name=${encodeURIComponent(tag.name)}`,
          };
        });
      }),
    );

    return images.flat();
  }

  private async ensureToken(): Promise<string | undefined> {
    if (this.token) return this.token;
    if (!this.config.username || !this.config.password) return undefined;

    const response = await fetch("https://hub.docker.com/v2/users/login/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.config.username, password: this.config.password }),
    });

    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as { token?: string };
    this.token = payload.token;
    return this.token;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const token = await this.ensureToken();
    const response = await fetch(`https://hub.docker.com${path}`, {
      headers: token
        ? {
            Authorization: `JWT ${token}`,
            Accept: "application/json",
          }
        : { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Docker Hub API error ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
