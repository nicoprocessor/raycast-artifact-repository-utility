import fetch from "node-fetch";
import {
  ProviderConfig,
  RegistryImage,
  RegistryProject,
  RegistryProjectMember,
  RegistryProvider,
  VulnerabilitySummary,
} from "./types";

type HarborSearchResponse = {
  repository?: Array<{
    project_name: string;
    repository_name: string;
  }>;
};

type HarborProject = {
  project_id: number;
  name: string;
  repo_count?: number;
  update_time?: string;
};

type HarborProjectMember = {
  id: number;
  entity_name: string;
  role_name: string;
};

type HarborArtifact = {
  digest: string;
  size?: number;
  push_time?: string;
  tags?: Array<{ name: string }>;
  scan_overview?: Record<string, { summary?: Record<string, number> }>;
};

const EMPTY_VULNERABILITY: VulnerabilitySummary = {
  unknown: 0,
  none: 0,
  low: 0,
  medium: 0,
  high: 0,
  critical: 0,
};

export class HarborProvider implements RegistryProvider {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly project?: string;

  constructor(private readonly config: ProviderConfig) {
    this.baseUrl = HarborProvider.normalizeBaseUrl(config.baseUrl);
    this.authorization = `Basic ${Buffer.from(`${config.username ?? ""}:${config.password ?? ""}`).toString("base64")}`;
    this.project = config.defaultProject?.trim() || undefined;
  }

  private static normalizeBaseUrl(baseUrl?: string): string {
    const raw = (baseUrl ?? "").trim();
    if (!raw) {
      throw new Error("Invalid Harbor base URL. Example: https://registry.invisiblefarm.it");
    }

    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    let parsed: URL;
    try {
      parsed = new URL(withProtocol);
    } catch {
      throw new Error("Invalid Harbor base URL. Example: https://registry.invisiblefarm.it");
    }

    return `${parsed.protocol}//${parsed.host}`;
  }

  async searchImages(query: string): Promise<RegistryImage[]> {
    if (!query.trim()) return [];

    const repositories = this.project
      ? await this.listRepositoriesFromProject(this.project)
      : await this.searchRepositories(query);

    const source = repositories.slice(0, 15);
    const artifacts = await Promise.all(source.map((repo) => this.fetchArtifacts(repo.project, repo.repository)));

    return artifacts
      .flat()
      .filter((image) => {
        const normalized = query.toLowerCase();
        return (
          image.repository.toLowerCase().includes(normalized) ||
          image.tag.toLowerCase().includes(normalized) ||
          image.digest.toLowerCase().includes(normalized)
        );
      })
      .sort((a, b) => this.sortImages(a, b));
  }

  async listProjects(query = ""): Promise<RegistryProject[]> {
    const projects = await this.fetchJson<HarborProject[]>("/api/v2.0/projects?page=1&page_size=100");

    return projects
      .filter((project) => project.name.toLowerCase().includes(query.toLowerCase()))
      .map((project) => ({
        id: `${this.config.id}:${project.project_id}`,
        providerId: this.config.id,
        providerLabel: this.config.label,
        name: project.name,
        repoCount: project.repo_count,
        updateTime: project.update_time,
        projectUrl: `${this.baseUrl}/harbor/projects/${encodeURIComponent(project.name)}/repositories`,
      }))
      .sort((a, b) => (b.updateTime ?? "").localeCompare(a.updateTime ?? ""));
  }

  async listProjectMembers(projectName: string): Promise<RegistryProjectMember[]> {
    const members = await this.fetchJson<HarborProjectMember[]>(
      `/api/v2.0/projects/${encodeURIComponent(projectName)}/members?page=1&page_size=100`,
    );

    return members
      .map((member) => ({
        id: String(member.id),
        username: member.entity_name,
        role: member.role_name,
      }))
      .sort((a, b) => a.username.localeCompare(b.username));
  }

  async deleteTag(projectName: string, repositoryName: string, reference: string, tagName: string): Promise<void> {
    await this.fetchNoContent(
      `/api/v2.0/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(
        repositoryName,
      )}/artifacts/${encodeURIComponent(reference)}/tags/${encodeURIComponent(tagName)}`,
      "DELETE",
    );
  }

  async deleteArtifact(projectName: string, repositoryName: string, reference: string): Promise<void> {
    await this.fetchNoContent(
      `/api/v2.0/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(
        repositoryName,
      )}/artifacts/${encodeURIComponent(reference)}`,
      "DELETE",
    );
  }

  async triggerScan(projectName: string, repositoryName: string, reference: string): Promise<void> {
    await this.fetchNoContent(
      `/api/v2.0/projects/${encodeURIComponent(projectName)}/repositories/${encodeURIComponent(
        repositoryName,
      )}/artifacts/${encodeURIComponent(reference)}/scan`,
      "POST",
    );
  }

  private async searchRepositories(query: string): Promise<Array<{ project: string; repository: string }>> {
    const response = await this.fetchJson<HarborSearchResponse>(`/api/v2.0/search?q=${encodeURIComponent(query)}`);
    const repositories = response.repository ?? [];

    return repositories.map((repo) => ({
      project: repo.project_name,
      repository: repo.repository_name.startsWith(`${repo.project_name}/`)
        ? repo.repository_name.slice(repo.project_name.length + 1)
        : repo.repository_name,
    }));
  }

  private async listRepositoriesFromProject(
    projectName: string,
  ): Promise<Array<{ project: string; repository: string }>> {
    const repositories = await this.fetchJson<Array<{ name: string }>>(
      `/api/v2.0/projects/${encodeURIComponent(projectName)}/repositories?page=1&page_size=100`,
    );

    return repositories.map((repo) => ({
      project: projectName,
      repository: repo.name.startsWith(`${projectName}/`) ? repo.name.slice(projectName.length + 1) : repo.name,
    }));
  }

  private async fetchArtifacts(project: string, repository: string): Promise<RegistryImage[]> {
    const path = `/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${encodeURIComponent(
      repository,
    )}/artifacts?with_tag=true&with_scan_overview=true&page_size=40`;
    const artifacts = await this.fetchJson<HarborArtifact[]>(path);

    return artifacts
      .flatMap((artifact) => {
        const tags = artifact.tags?.length ? artifact.tags : [{ name: "untagged" }];
        const vulnerabilitySummary = this.parseScanSummary(artifact.scan_overview);
        const repoFullName = `${project}/${repository}`;

        return tags.map((tag) => ({
          id: `${this.config.id}:${repoFullName}:${tag.name}`,
          providerId: this.config.id,
          providerLabel: this.config.label,
          project,
          repository: repoFullName,
          repositoryName: repository,
          tag: tag.name,
          digest: artifact.digest,
          pushedAt: artifact.push_time,
          sizeBytes: artifact.size,
          scanStatus: artifact.scan_overview ? ("scanned" as const) : ("not-scanned" as const),
          vulnerabilitySummary,
          projectUrl: `${this.baseUrl}/harbor/projects/${encodeURIComponent(project)}/repositories`,
          artifactUrl: `${this.baseUrl}/harbor/projects/${encodeURIComponent(
            project,
          )}/repositories/${encodeURIComponent(repository)}/artifacts-tab`,
        }));
      })
      .sort((a, b) => this.sortImages(a, b));
  }

  private sortImages(a: RegistryImage, b: RegistryImage): number {
    const pushOrder = (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "");
    if (pushOrder !== 0) return pushOrder;
    if (a.tag === "latest" && b.tag !== "latest") return -1;
    if (b.tag === "latest" && a.tag !== "latest") return 1;
    return a.tag.localeCompare(b.tag);
  }

  private parseScanSummary(scanOverview?: HarborArtifact["scan_overview"]): VulnerabilitySummary {
    if (!scanOverview) return { ...EMPTY_VULNERABILITY };

    const summary: VulnerabilitySummary = { ...EMPTY_VULNERABILITY };
    for (const scannerReport of Object.values(scanOverview)) {
      const scannerSummary = scannerReport.summary ?? {};
      for (const [key, count] of Object.entries(scannerSummary)) {
        const normalized = key.toLowerCase() as keyof VulnerabilitySummary;
        if (normalized in summary) {
          summary[normalized] += count;
        }
      }
    }

    return summary;
  }

  private async fetchNoContent(path: string, method: "DELETE" | "POST"): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: this.authorization,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Harbor API error ${response.status}: ${response.statusText}`);
    }
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        Authorization: this.authorization,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Harbor API error ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as T;
  }
}
