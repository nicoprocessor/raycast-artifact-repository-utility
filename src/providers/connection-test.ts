import { createProvider } from "./index";
import { ProviderConfig, RegistryProvider, RegistryRepository } from "./types";

type ConnectionTestStatus = "ok" | "failed";
type ConnectionTestErrorKind =
  | "auth"
  | "permissions"
  | "network"
  | "rate-limit"
  | "provider-contract"
  | "api"
  | "unknown";

export type ProviderConnectionTestResult = {
  status: ConnectionTestStatus;
  summary: string;
  markdownLog: string;
  error?: string;
  errorKind?: ConnectionTestErrorKind;
  suggestedFix?: string;
};

type TestContext = {
  provider: RegistryProvider;
  config: ProviderConfig;
  logs: string[];
};

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function toLower(value: string): string {
  return value.toLowerCase();
}

function classifyError(error: unknown): { kind: ConnectionTestErrorKind; suggestedFix: string } {
  const message = toLower(toMessage(error));

  if (message.includes("is not a function") || message.includes("does not expose")) {
    return {
      kind: "provider-contract",
      suggestedFix: "The provider implementation is incomplete or outdated. Update/rebuild the extension/provider.",
    };
  }

  if (
    message.includes("401") ||
    message.includes("unauthorized") ||
    message.includes("forbidden") ||
    message.includes("403")
  ) {
    return {
      kind: "auth",
      suggestedFix: "Check username/token/password and ensure the credentials are valid for this registry.",
    };
  }

  if (message.includes("permission") || message.includes("denied") || message.includes("insufficient scope")) {
    return {
      kind: "permissions",
      suggestedFix:
        "Credentials are valid but missing scopes/permissions. Grant read access to projects/repositories/artifacts.",
    };
  }

  if (
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("fetch failed") ||
    message.includes("network")
  ) {
    return {
      kind: "network",
      suggestedFix: "Check base URL, DNS/VPN/network reachability and TLS certificate trust.",
    };
  }

  if (message.includes("429") || message.includes("rate limit") || message.includes("too many requests")) {
    return {
      kind: "rate-limit",
      suggestedFix: "API rate limit reached. Retry later or reduce refresh frequency/concurrency.",
    };
  }

  if (message.includes("api error") || message.includes(" 5")) {
    return {
      kind: "api",
      suggestedFix: "Registry API returned an error. Retry and inspect provider/API health logs.",
    };
  }

  return {
    kind: "unknown",
    suggestedFix: "Inspect the full test log and verify provider configuration fields.",
  };
}

function formatMarkdownLog(
  config: ProviderConfig,
  logs: string[],
  diagnostics?: { kind: ConnectionTestErrorKind; suggestedFix: string; error: string },
): string {
  const body = logs.join("\n");
  const diagnosticsSection = diagnostics
    ? [
        "",
        "### Diagnostics",
        "",
        `- Error Type: ${diagnostics.kind}`,
        `- Error: ${diagnostics.error}`,
        `- Suggested Fix: ${diagnostics.suggestedFix}`,
      ].join("\n")
    : "";

  return [
    "## Provider Connection Test",
    "",
    `- Provider: ${config.label} (${config.kind})`,
    `- Timestamp: ${new Date().toISOString()}`,
    diagnostics ? `- Result: FAILED (${diagnostics.kind})` : "- Result: OK",
    diagnostics ? `- Suggested Fix: ${diagnostics.suggestedFix}` : "- Suggested Fix: none",
    diagnosticsSection,
    "",
    "```text",
    body,
    "```",
  ].join("\n");
}

async function runStep<T>(ctx: TestContext, label: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  ctx.logs.push(`[START] ${label}`);
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    ctx.logs.push(`[OK] ${label} (${elapsed} ms)`);
    return result;
  } catch (error) {
    const elapsed = Date.now() - start;
    const message = toMessage(error);
    ctx.logs.push(`[FAIL] ${label} (${elapsed} ms) -> ${message}`);
    throw error;
  }
}

function ensureProviderContract(provider: RegistryProvider): void {
  const requiredMethods: Array<keyof RegistryProvider> = [
    "listProjects",
    "searchImages",
    "listProjectRepositories",
    "listRepositoryArtifacts",
    "getLatestRepositoryTag",
  ];

  const missing = requiredMethods.filter((method) => typeof provider[method] !== "function");
  if (missing.length > 0) {
    throw new Error(`Provider does not expose required methods: ${missing.join(", ")}`);
  }
}

async function runHarborSpecificChecks(ctx: TestContext, discoveredProjects: string[]): Promise<void> {
  const configuredProject = ctx.config.defaultProject?.trim();
  const projectForRepoCheck = configuredProject || discoveredProjects[0];
  if (!projectForRepoCheck) {
    ctx.logs.push("[INFO] Harbor repository check skipped (no project available yet).");
    return;
  }

  const repositories = await runStep(ctx, `List repositories in project '${projectForRepoCheck}'`, () =>
    ctx.provider.listProjectRepositories(projectForRepoCheck, ""),
  );

  if (repositories.length === 0) {
    ctx.logs.push("[INFO] No repositories found; latest-tag check skipped.");
    return;
  }

  await checkRepositoryEndpoints(ctx, projectForRepoCheck, repositories[0]);
}

async function runDockerSpecificChecks(ctx: TestContext, discoveredProjects: string[]): Promise<void> {
  const namespace = (ctx.config.defaultNamespace ?? ctx.config.username)?.trim() || discoveredProjects[0];
  if (!namespace) {
    ctx.logs.push("[INFO] Docker repository check skipped (no namespace available).");
    return;
  }

  const repositories = await runStep(ctx, `List repositories in namespace '${namespace}'`, () =>
    ctx.provider.listProjectRepositories(namespace, ""),
  );

  if (repositories.length === 0) {
    ctx.logs.push("[INFO] No repositories found; latest-tag check skipped.");
    return;
  }

  await checkRepositoryEndpoints(ctx, namespace, repositories[0]);
}

async function checkRepositoryEndpoints(
  ctx: TestContext,
  projectName: string,
  repository: RegistryRepository,
): Promise<void> {
  await runStep(ctx, `Read latest tag for '${projectName}/${repository.name}'`, () =>
    ctx.provider.getLatestRepositoryTag(projectName, repository.name),
  );
  await runStep(ctx, `List artifacts for '${projectName}/${repository.name}'`, () =>
    ctx.provider.listRepositoryArtifacts(projectName, repository.name, ""),
  );
}

export async function runProviderConnectionTest(config: ProviderConfig): Promise<ProviderConnectionTestResult> {
  const provider = createProvider(config);
  const logs: string[] = [];
  const ctx: TestContext = { provider, config, logs };
  try {
    await runStep(ctx, "Validate provider method contract", async () => {
      ensureProviderContract(provider);
    });

    const projects = await runStep(ctx, "List projects", () => provider.listProjects(""));
    const projectNames = projects.map((project) => project.name);

    // Exercises search APIs used by Search Images command without requiring any data to exist.
    await runStep(ctx, "Search images (healthcheck query)", () => provider.searchImages("__raycast_healthcheck__"));

    if (config.kind === "private-harbor") {
      await runHarborSpecificChecks(ctx, projectNames);
    } else if (config.kind === "docker-hub") {
      await runDockerSpecificChecks(ctx, projectNames);
    }

    logs.push("[DONE] Provider configuration passed connectivity checks.");
    return {
      status: "ok",
      summary: "Connection test passed",
      markdownLog: formatMarkdownLog(config, logs),
    };
  } catch (error) {
    const message = toMessage(error);
    const diagnostics = classifyError(error);
    logs.push(`[DONE] Provider configuration failed connectivity checks: ${message}`);
    return {
      status: "failed",
      summary: `Connection test failed (${diagnostics.kind})`,
      markdownLog: formatMarkdownLog(config, logs, { ...diagnostics, error: message }),
      error: message,
      errorKind: diagnostics.kind,
      suggestedFix: diagnostics.suggestedFix,
    };
  }
}
