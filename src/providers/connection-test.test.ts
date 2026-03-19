import { beforeEach, describe, expect, it, vi } from "vitest";
import { runProviderConnectionTest } from "./connection-test";
import { createProvider } from "./index";
import { ProviderConfig, RegistryProvider } from "./types";

vi.mock("./index", () => ({
  createProvider: vi.fn(),
}));

function buildConfig(kind: ProviderConfig["kind"] = "private-harbor"): ProviderConfig {
  return {
    id: "provider-1",
    kind,
    label: kind === "private-harbor" ? "Harbor" : "Docker Hub",
    baseUrl: "https://registry.example.com",
    username: "user",
    password: "token",
    defaultProject: "proj",
    defaultNamespace: "namespace",
  };
}

function buildProvider(overrides?: Partial<RegistryProvider>): RegistryProvider {
  return {
    searchImages: vi.fn(async () => []),
    listProjects: vi.fn(async () => []),
    listProjectMembers: vi.fn(async () => []),
    listProjectRepositories: vi.fn(async () => []),
    listRepositoryArtifacts: vi.fn(async () => []),
    getLatestRepositoryTag: vi.fn(async () => "latest"),
    deleteTag: vi.fn(async () => undefined),
    deleteArtifact: vi.fn(async () => undefined),
    triggerScan: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("runProviderConnectionTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes when provider is reachable even with no projects", async () => {
    const provider = buildProvider({
      listProjects: vi.fn(async () => []),
      searchImages: vi.fn(async () => []),
    });
    vi.mocked(createProvider).mockReturnValue(provider);

    const result = await runProviderConnectionTest(buildConfig("private-harbor"));

    expect(result.status).toBe("ok");
    expect(result.summary).toContain("passed");
    expect(result.markdownLog).toContain("[START] List projects");
    expect(result.markdownLog).toContain("latest-tag check skipped");
  });

  it("fails with provider-contract when required methods are missing", async () => {
    const brokenProvider = {
      listProjects: vi.fn(async () => []),
      searchImages: vi.fn(async () => []),
    } as unknown as RegistryProvider;
    vi.mocked(createProvider).mockReturnValue(brokenProvider);

    const result = await runProviderConnectionTest(buildConfig("private-harbor"));

    expect(result.status).toBe("failed");
    expect(result.errorKind).toBe("provider-contract");
    expect(result.suggestedFix).toContain("incomplete or outdated");
    expect(result.markdownLog).toContain("Diagnostics");
  });

  it("classifies authentication failures", async () => {
    const provider = buildProvider({
      listProjects: vi.fn(async () => {
        throw new Error("401 Unauthorized");
      }),
    });
    vi.mocked(createProvider).mockReturnValue(provider);

    const result = await runProviderConnectionTest(buildConfig("private-harbor"));

    expect(result.status).toBe("failed");
    expect(result.errorKind).toBe("auth");
    expect(result.suggestedFix).toContain("credentials");
  });

  it("executes repository-level checks when repositories exist", async () => {
    const listProjectRepositories = vi.fn(async () => [{ id: "1", name: "repo1", url: "https://example.com/repo1" }]);
    const getLatestRepositoryTag = vi.fn(async () => "1.2.3");
    const listRepositoryArtifacts = vi.fn(async () => []);
    const provider = buildProvider({
      listProjects: vi.fn(async () => [
        {
          id: "p1",
          providerId: "provider-1",
          providerLabel: "Harbor",
          name: "proj",
          projectUrl: "https://example.com/proj",
        },
      ]),
      listProjectRepositories,
      getLatestRepositoryTag,
      listRepositoryArtifacts,
    });
    vi.mocked(createProvider).mockReturnValue(provider);

    const result = await runProviderConnectionTest(buildConfig("private-harbor"));

    expect(result.status).toBe("ok");
    expect(listProjectRepositories).toHaveBeenCalled();
    expect(getLatestRepositoryTag).toHaveBeenCalledWith("proj", "repo1");
    expect(listRepositoryArtifacts).toHaveBeenCalledWith("proj", "repo1", "");
  });

  it("classifies rate-limit failures", async () => {
    const provider = buildProvider({
      listProjects: vi.fn(async () => {
        throw new Error("429 Too Many Requests");
      }),
    });
    vi.mocked(createProvider).mockReturnValue(provider);

    const result = await runProviderConnectionTest(buildConfig("docker-hub"));

    expect(result.status).toBe("failed");
    expect(result.errorKind).toBe("rate-limit");
    expect(result.suggestedFix).toContain("Retry later");
  });
});
