export type VulnerabilitySummary = {
  unknown: number;
  none: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
};

export type ProviderKind = "private-arbor" | "docker-hub";

export type ProviderConfig = {
  id: string;
  kind: ProviderKind;
  label: string;
  baseUrl?: string;
  username?: string;
  password?: string;
  defaultProject?: string;
  defaultNamespace?: string;
};

export type RegistryImage = {
  id: string;
  providerId: string;
  providerLabel: string;
  project: string;
  repository: string;
  repositoryName: string;
  tag: string;
  digest: string;
  pushedAt?: string;
  sizeBytes?: number;
  scanStatus: "not-scanned" | "scanned";
  vulnerabilitySummary: VulnerabilitySummary;
  projectUrl: string;
  artifactUrl: string;
};

export type RegistryProject = {
  id: string;
  providerId: string;
  providerLabel: string;
  name: string;
  repoCount?: number;
  updateTime?: string;
  projectUrl: string;
};

export type RegistryProjectMember = {
  id: string;
  username: string;
  role: string;
};

export interface RegistryProvider {
  searchImages(query: string): Promise<RegistryImage[]>;
  listProjects(query?: string): Promise<RegistryProject[]>;
  listProjectMembers(projectName: string): Promise<RegistryProjectMember[]>;
  deleteTag(projectName: string, repositoryName: string, reference: string, tagName: string): Promise<void>;
  deleteArtifact(projectName: string, repositoryName: string, reference: string): Promise<void>;
  triggerScan(projectName: string, repositoryName: string, reference: string): Promise<void>;
}
