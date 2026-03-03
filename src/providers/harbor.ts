import { getPreferenceValues } from "@raycast/api";
import fetch from "node-fetch";
import { RegistryImage, RegistryProvider } from "./types";

type Preferences = {
  harborBaseUrl: string;
  harborUsername: string;
  harborPassword: string;
  harborProject?: string;
};

type HarborSearchResponse = {
  repository?: Array<{
    project_name: string;
    repository_name: string;
  }>;
};

type HarborArtifact = {
  id: number;
  digest: string;
  size?: number;
  push_time?: string;
  tags?: Array<{ name: string }>;
  scan_overview?: Record<string, { summary?: Record<string, number> }>;
};

export class HarborProvider implements RegistryProvider {
  private readonly baseUrl: string;
  private readonly authorization: string;
  private readonly project?: string;

  constructor() {
    const prefs = getPreferenceValues<Preferences>();
    this.baseUrl = prefs.harborBaseUrl.replace(/\/$/, "");
    this.authorization = `Basic ${Buffer.from(`${prefs.harborUsername}:${prefs.harborPassword}`).toString("base64")}`;
    this.project = prefs.harborProject?.trim() || undefined;
  }

  async searchImages(query: string): Promise<RegistryImage[]> {
    if (!query.trim()) return [];

    const repos = await this.searchRepositories(query);
    const images = await Promise.all(
      repos.slice(0, 8).map((repo) => this.fetchArtifacts(repo.project, repo.repository)),
    );
    return images.flat();
  }

  private async searchRepositories(query: string): Promise<Array<{ project: string; repository: string }>> {
    if (this.project) {
      return [{ project: this.project, repository: query }];
    }

    const response = await this.fetchJson<HarborSearchResponse>(`/api/v2.0/search?q=${encodeURIComponent(query)}`);
    const repositories = response.repository ?? [];

    return repositories.map((repo) => ({
      project: repo.project_name,
      repository: repo.repository_name.startsWith(`${repo.project_name}/`)
        ? repo.repository_name.slice(repo.project_name.length + 1)
        : repo.repository_name,
    }));
  }

  private async fetchArtifacts(project: string, repository: string): Promise<RegistryImage[]> {
    const repoPath = encodeURIComponent(repository);
    const path = `/api/v2.0/projects/${encodeURIComponent(
      project,
    )}/repositories/${repoPath}/artifacts?with_tag=true&with_scan_overview=true&page_size=20`;
    const artifacts = await this.fetchJson<HarborArtifact[]>(path);

    return artifacts.flatMap((artifact) => {
      const tags = artifact.tags?.length ? artifact.tags : [{ name: "untagged" }];
      const vulnerabilitySummary = this.formatScanSummary(artifact.scan_overview);
      return tags.map((tag) => ({
        id: `${project}/${repository}:${tag.name}`,
        repository: `${project}/${repository}`,
        tag: tag.name,
        digest: artifact.digest,
        pushedAt: artifact.push_time,
        sizeBytes: artifact.size,
        vulnerabilitySummary,
      }));
    });
  }

  private formatScanSummary(scanOverview?: HarborArtifact["scan_overview"]): string | undefined {
    if (!scanOverview) return undefined;

    const summaries = Object.values(scanOverview)
      .map((scan) => scan.summary)
      .filter((summary): summary is Record<string, number> => Boolean(summary));

    if (!summaries.length) return undefined;

    const merged = summaries.reduce<Record<string, number>>((acc, summary) => {
      for (const [severity, count] of Object.entries(summary)) {
        acc[severity] = (acc[severity] ?? 0) + count;
      }
      return acc;
    }, {});

    return Object.entries(merged)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([severity, count]) => `${severity}:${count}`)
      .join(" · ");
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
