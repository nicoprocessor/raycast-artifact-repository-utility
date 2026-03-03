import { LocalStorage } from "@raycast/api";
import { ProviderConfig } from "./types";

const PROVIDERS_KEY = "registry-providers";

export async function getProviderConfigs(): Promise<ProviderConfig[]> {
  const raw = await LocalStorage.getItem<string>(PROVIDERS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ProviderConfig[];
    return Array.isArray(parsed) ? parsed : [];
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
