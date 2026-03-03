import { getPreferenceValues } from "@raycast/api";
import { HarborProvider } from "./harbor";
import { ProviderName, RegistryProvider } from "./types";

type Preferences = {
  provider: ProviderName;
};

export function getRegistryProvider(): RegistryProvider {
  const { provider } = getPreferenceValues<Preferences>();

  switch (provider) {
    case "harbor":
      return new HarborProvider();
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}
