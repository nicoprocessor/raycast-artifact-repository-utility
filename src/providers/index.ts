import { HarborProvider } from "./harbor";
import { DockerHubProvider } from "./dockerhub";
import { getProviderConfigs } from "./storage";
import { ProviderConfig, RegistryProvider } from "./types";

export function providerIcon(kind: ProviderConfig["kind"]): string {
  switch (kind) {
    case "private-arbor":
      return "assets/providers/private-arbor.png";
    case "docker-hub":
      return "assets/providers/docker-hub.png";
    default:
      return "assets/icon.png";
  }
}

export function createProvider(config: ProviderConfig): RegistryProvider {
  switch (config.kind) {
    case "private-arbor":
      return new HarborProvider(config);
    case "docker-hub":
      return new DockerHubProvider(config);
    default:
      throw new Error(`Unsupported provider: ${config.kind}`);
  }
}

export async function getProviderClients(
  filterProviderId?: string,
): Promise<Array<{ config: ProviderConfig; client: RegistryProvider }>> {
  const configs = await getProviderConfigs();
  const filtered = filterProviderId ? configs.filter((config) => config.id === filterProviderId) : configs;
  return filtered.map((config) => ({ config, client: createProvider(config) }));
}
