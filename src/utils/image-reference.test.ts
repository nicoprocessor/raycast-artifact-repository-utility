import { describe, expect, it } from "vitest";
import { buildFullArtifactPath, registryHost } from "./image-reference";

describe("registryHost", () => {
  it("returns docker.io for Docker Hub", () => {
    expect(registryHost("docker-hub")).toBe("docker.io");
  });

  it("extracts host from Harbor URL", () => {
    expect(registryHost("private-harbor", "https://registry.acme.inc/harbor")).toBe("registry.acme.inc");
  });

  it("supports Harbor URL without protocol", () => {
    expect(registryHost("private-harbor", "registry.acme.inc/harbor")).toBe("registry.acme.inc");
  });
});

describe("buildFullArtifactPath", () => {
  it("builds full path with provider host", () => {
    expect(buildFullArtifactPath("private-harbor", "team/app", "1.0.0", "https://registry.acme.inc")).toBe(
      "registry.acme.inc/team/app:1.0.0",
    );
  });
});
