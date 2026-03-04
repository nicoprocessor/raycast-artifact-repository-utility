import { ProviderKind } from "../providers/types";

export function registryHost(kind: ProviderKind, baseUrl?: string): string {
  if (kind === "docker-hub") return "docker.io";
  if (!baseUrl) return "";
  try {
    const normalized = /^https?:\/\//i.test(baseUrl) ? baseUrl : `https://${baseUrl}`;
    return new URL(normalized).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  }
}

export function buildFullArtifactPath(kind: ProviderKind, repository: string, tag: string, baseUrl?: string): string {
  const host = registryHost(kind, baseUrl);
  return host ? `${host}/${repository}:${tag}` : `${repository}:${tag}`;
}
