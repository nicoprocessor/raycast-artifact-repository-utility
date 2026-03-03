import { Action, ActionPanel, Alert, Color, confirmAlert, Icon, List, showHUD, showToast, Toast } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo, useState } from "react";
import { AddProviderForm } from "./manage-providers";
import { getProviderClients, providerIcon } from "./providers";
import { RegistryImage, VulnerabilitySummary } from "./providers/types";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function severityBadge(scanStatus: RegistryImage["scanStatus"], summary: VulnerabilitySummary) {
  if (scanStatus === "not-scanned") {
    return { text: "Not scanned", icon: Icon.Clock, color: Color.SecondaryText };
  }
  if (summary.critical > 0) return { text: `Critical ${summary.critical}`, icon: Icon.Dot, color: Color.Red };
  if (summary.high > 0) return { text: `High ${summary.high}`, icon: Icon.Dot, color: Color.Orange };
  if (summary.medium > 0) return { text: `Medium ${summary.medium}`, icon: Icon.Dot, color: Color.Yellow };
  if (summary.low > 0) return { text: `Low ${summary.low}`, icon: Icon.Dot, color: Color.Blue };
  return { text: "Scanned: no vulnerabilities", icon: Icon.CheckCircle, color: Color.Green };
}

function vulnDetail(summary: VulnerabilitySummary) {
  return `critical:${summary.critical} · high:${summary.high} · medium:${summary.medium} · low:${summary.low} · unknown:${summary.unknown}`;
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const { value: hideUntaggedRaw, setValue: setHideUntaggedRaw } = useLocalStorage<string>(
    "search-images-hide-untagged",
    "false",
  );
  const hideUntagged = hideUntaggedRaw === "true";

  const { data, isLoading, error, revalidate } = useCachedPromise(
    async (query: string, selectedProviderId: string) => {
      if (!query.trim())
        return { images: [] as RegistryImage[], providers: await getProviderClients(), failures: [] as string[] };
      const providers = await getProviderClients(selectedProviderId === "all" ? undefined : selectedProviderId);
      const results = await Promise.all(
        providers.map(async ({ config, client }) => {
          try {
            const images = await client.searchImages(query);
            return {
              images: images.map((image) => ({ ...image, providerLabel: config.label })),
              failure: undefined as string | undefined,
            };
          } catch (providerError) {
            const message = providerError instanceof Error ? providerError.message : String(providerError);
            return { images: [] as RegistryImage[], failure: `${config.label}: ${message}` };
          }
        }),
      );

      return {
        images: results
          .flatMap((result) => result.images)
          .sort((a, b) => (b.pushedAt ?? "").localeCompare(a.pushedAt ?? "")),
        providers,
        failures: results.map((result) => result.failure).filter((item): item is string => Boolean(item)),
      };
    },
    [searchText, providerFilter],
    { keepPreviousData: true },
  );

  const providers = useMemo(() => data?.providers ?? [], [data]);
  const images = useMemo(
    () => (data?.images ?? []).filter((image) => (hideUntagged ? image.tag.toLowerCase() !== "untagged" : true)),
    [data, hideUntagged],
  );
  const failures = useMemo(() => data?.failures ?? [], [data]);

  async function runAction(action: () => Promise<void>, loadingTitle: string, doneTitle: string) {
    await showToast({ style: Toast.Style.Animated, title: loadingTitle });
    await action();
    await revalidate();
    await showHUD(doneTitle);
  }

  async function onDeleteTag(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete tag ${image.tag}?`,
      message: `${image.providerLabel} · ${image.repository}:${image.tag}`,
      primaryAction: { title: "Delete Tag", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const provider = providers.find((item) => item.config.id === image.providerId);
    if (!provider) return;

    await runAction(
      () => provider.client.deleteTag(image.project, image.repositoryName, image.digest, image.tag),
      "Deleting tag...",
      "Tag deleted",
    );
  }

  async function onDeleteArtifact(image: RegistryImage) {
    const confirmed = await confirmAlert({
      title: `Delete artifact ${image.digest.slice(0, 16)}...?`,
      message: `${image.providerLabel} · ${image.repository}`,
      primaryAction: { title: "Delete Artifact", style: Alert.ActionStyle.Destructive },
    });
    if (!confirmed) return;

    const provider = providers.find((item) => item.config.id === image.providerId);
    if (!provider) return;

    await runAction(
      () => provider.client.deleteArtifact(image.project, image.repositoryName, image.digest),
      "Deleting artifact...",
      "Artifact deleted",
    );
  }

  async function onTriggerScan(image: RegistryImage) {
    const provider = providers.find((item) => item.config.id === image.providerId);
    if (!provider) return;

    await runAction(
      () => provider.client.triggerScan(image.project, image.repositoryName, image.digest),
      "Starting scan...",
      "Scan started",
    );
  }

  const providerDropdown = (
    <List.Dropdown tooltip="Filter Provider" value={providerFilter} onChange={setProviderFilter}>
      <List.Dropdown.Item title="All Providers" value="all" />
      {providers.map(({ config }) => (
        <List.Dropdown.Item key={config.id} title={config.label} value={config.id} icon={providerIcon(config.kind)} />
      ))}
    </List.Dropdown>
  );

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search tag / image / project / digest"
      searchBarAccessory={providerDropdown}
      throttle
      isShowingDetail
    >
      {error ? <List.EmptyView title="Request failed" description={error.message} icon={Icon.ExclamationMark} /> : null}
      {providers.length === 0 ? (
        <List.Item
          title="No providers configured"
          subtitle="Press ⌘N to add one"
          icon={Icon.Plus}
          actions={
            <ActionPanel>
              <Action.Push
                title="Add Provider"
                target={<AddProviderForm onSaved={revalidate} />}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
            </ActionPanel>
          }
        />
      ) : null}
      {!searchText.trim() && providers.length > 0 ? (
        <List.EmptyView title="Type to search" description="Default search runs across all configured providers" />
      ) : null}
      {searchText.trim() && images.length === 0 && failures.length > 0 ? (
        <List.EmptyView title="Search failed" description={failures.join(" | ")} icon={Icon.ExclamationMark} />
      ) : null}
      {searchText.trim() && images.length === 0 && failures.length === 0 && hideUntagged ? (
        <List.EmptyView
          title="No tagged images found"
          description="Disable 'Hide Untagged Images' to include untagged artifacts."
        />
      ) : null}

      {images.map((image) => {
        const severity = severityBadge(image.scanStatus, image.vulnerabilitySummary);
        return (
          <List.Item
            key={image.id}
            icon={providerIcon(
              providers.find((entry) => entry.config.id === image.providerId)?.config.kind ?? "private-arbor",
            )}
            title={image.tag}
            subtitle={image.repository}
            accessories={[{ icon: { source: severity.icon, tintColor: severity.color }, tooltip: severity.text }]}
            detail={
              <List.Item.Detail
                markdown={[
                  `# ${image.repository}:${image.tag}`,
                  `- **Provider:** ${image.providerLabel}`,
                  `- **Project:** ${image.project}`,
                  `- **Digest:** \`${image.digest}\``,
                  `- **Size:** ${formatBytes(image.sizeBytes)}`,
                  `- **Pushed At:** ${image.pushedAt ? new Date(image.pushedAt).toLocaleString() : "-"}`,
                  `- **Scan Status:** ${image.scanStatus}`,
                  `- **Vulnerabilities:** ${vulnDetail(image.vulnerabilitySummary)}`,
                ].join("\n")}
              />
            }
            actions={
              <ActionPanel>
                <Action.CopyToClipboard title="Copy Image Reference" content={`${image.repository}:${image.tag}`} />
                <Action.CopyToClipboard title="Copy Digest" content={image.digest} />
                <Action.OpenInBrowser title="Open Artifact in Browser" url={image.artifactUrl} />
                <Action.OpenInBrowser title="Open Project in Browser" url={image.projectUrl} />
                <Action
                  title={hideUntagged ? "Show Untagged Images" : "Hide Untagged Images"}
                  icon={Icon.Filter}
                  onAction={() => setHideUntaggedRaw(String(!hideUntagged))}
                />
                <Action title="Trigger Scan" icon={Icon.MagnifyingGlass} onAction={() => onTriggerScan(image)} />
                <Action
                  title="Delete Tag"
                  style={Action.Style.Destructive}
                  icon={Icon.Trash}
                  onAction={() => onDeleteTag(image)}
                />
                <Action
                  title="Delete Artifact"
                  style={Action.Style.Destructive}
                  icon={Icon.Trash}
                  onAction={() => onDeleteArtifact(image)}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
