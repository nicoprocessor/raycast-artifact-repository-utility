import { Action, ActionPanel, Color, Icon, List } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { getRegistryProvider } from "./providers";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const provider = useMemo(() => getRegistryProvider(), []);
  const { data, isLoading, error } = useCachedPromise((query: string) => provider.searchImages(query), [searchText], {
    keepPreviousData: true,
    execute: Boolean(searchText.trim()),
  });

  return (
    <List
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      searchBarPlaceholder="Search Harbor images (repository/tag)"
      throttle
      isShowingDetail
    >
      {error ? <List.EmptyView title="Request failed" description={error.message} icon={Icon.ExclamationMark} /> : null}
      {!searchText.trim() ? (
        <List.EmptyView title="Type to search" description="Start typing an image or repository name" />
      ) : null}
      {(data ?? []).map((image) => (
        <List.Item
          key={image.id}
          icon={Icon.Box}
          title={`${image.repository}:${image.tag}`}
          subtitle={formatBytes(image.sizeBytes)}
          accessories={[
            image.pushedAt ? { text: new Date(image.pushedAt).toLocaleString() } : { text: "" },
            image.vulnerabilitySummary
              ? { tag: { value: image.vulnerabilitySummary, color: Color.Orange } }
              : { text: "" },
          ]}
          detail={
            <List.Item.Detail
              markdown={[
                `# ${image.repository}:${image.tag}`,
                `- **Digest:** \`${image.digest}\``,
                `- **Size:** ${formatBytes(image.sizeBytes)}`,
                `- **Pushed At:** ${image.pushedAt ? new Date(image.pushedAt).toLocaleString() : "-"}`,
                `- **Vulnerabilities:** ${image.vulnerabilitySummary ?? "Not available"}`,
              ].join("\n")}
            />
          }
          actions={
            <ActionPanel>
              <Action.CopyToClipboard title="Copy Image Reference" content={`${image.repository}:${image.tag}`} />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
