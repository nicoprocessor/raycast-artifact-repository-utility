import { LocalStorage } from "@raycast/api";
import { ProviderConfig } from "./types";

const PROVIDERS_KEY = "registry-providers";
const ENABLE_DOCKER_HUB_BETA = false;

export async function getProviderConfigs(): Promise<ProviderConfig[]> {
  const raw = await LocalStorage.getItem<string>(PROVIDERS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ProviderConfig[];
    if (!Array.isArray(parsed)) return [];
    const filtered = ENABLE_DOCKER_HUB_BETA ? parsed : parsed.filter((provider) => provider.kind !== "docker-hub");

    // Self-heal existing local state so users keep only supported providers.
    if (filtered.length !== parsed.length) {
      await LocalStorage.setItem(PROVIDERS_KEY, JSON.stringify(filtered));
    }

    return filtered;
  } catch {
    return [];
  }
}

export async function saveProviderConfigs(configs: ProviderConfig[]): Promise<void> {
  await LocalStorage.setItem(PROVIDERS_KEY, JSON.stringify(configs));
}

export async function addProviderConfig(config: ProviderConfig): Promise<void> {
  const existing = await getProviderConfigs();
  await saveProviderConfigs([...existing, config]);
}

export async function removeProviderConfig(providerId: string): Promise<void> {
  const existing = await getProviderConfigs();
  await saveProviderConfigs(existing.filter((provider) => provider.id !== providerId));
}

export async function updateProviderConfig(providerId: string, next: ProviderConfig): Promise<void> {
  const existing = await getProviderConfigs();
  await saveProviderConfigs(existing.map((provider) => (provider.id === providerId ? next : provider)));
}
