export type RegistryImage = {
  id: string;
  repository: string;
  tag: string;
  digest: string;
  pushedAt?: string;
  sizeBytes?: number;
  vulnerabilitySummary?: string;
};

export interface RegistryProvider {
  searchImages(query: string): Promise<RegistryImage[]>;
}

export type ProviderName = "harbor";
