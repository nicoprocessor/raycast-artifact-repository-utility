import { Action, ActionPanel, Form, Icon, List, showHUD, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { useMemo, useState } from "react";
import { createProvider, providerIcon } from "./providers";
import { addProviderConfig, getProviderConfigs, removeProviderConfig, updateProviderConfig } from "./providers/storage";
import { ProviderConfig, ProviderKind } from "./providers/types";

function buildProviderLabel(kind: ProviderKind, customLabel?: string): string {
  if (customLabel?.trim()) return customLabel.trim();
  return kind === "private-arbor" ? "Private Harbor" : "Docker Hub";
}

export function AddProviderForm(props: { onSaved?: () => Promise<void> | void }) {
  const { pop } = useNavigation();
  const [kind, setKind] = useState<ProviderKind>("private-arbor");
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(values: {
    kind: ProviderKind;
    label?: string;
    baseUrl?: string;
    username?: string;
    password?: string;
    defaultProject?: string;
    defaultNamespace?: string;
  }) {
    setIsLoading(true);
    try {
      if (values.kind === "private-arbor" && !values.baseUrl?.trim()) {
        throw new Error("Registry Base URL is required for Private Harbor.");
      }
      if (!values.username?.trim() || !values.password?.trim()) {
        throw new Error("Username and Password/Token are required.");
      }

      const config: ProviderConfig = {
        id: `${Date.now()}`,
        kind: values.kind,
        label: buildProviderLabel(values.kind, values.label),
        baseUrl: values.kind === "private-arbor" ? values.baseUrl?.trim() : undefined,
        username: values.username?.trim(),
        password: values.password,
        defaultProject: values.kind === "private-arbor" ? values.defaultProject?.trim() : undefined,
        defaultNamespace: values.kind === "docker-hub" ? values.defaultNamespace?.trim() : undefined,
      };

      await addProviderConfig(config);
      await showHUD(`Provider added: ${config.label}`);
      if (props.onSaved) await props.onSaved();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to save provider",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      navigationTitle="Add Registry Provider"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Provider" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="kind" title="Provider" value={kind} onChange={(value) => setKind(value as ProviderKind)}>
        <Form.Dropdown.Item value="private-arbor" title="Private Harbor" icon={providerIcon("private-arbor")} />
        <Form.Dropdown.Item value="docker-hub" title="Docker Hub (Beta)" icon={providerIcon("docker-hub")} />
      </Form.Dropdown>
      <Form.TextField
        id="label"
        title="Display Name"
        placeholder={kind === "private-arbor" ? "Private Harbor" : "Docker Hub"}
      />
      {kind === "private-arbor" ? (
        <>
          <Form.Description text="For Harbor, use only the base URL. Example: https://registry.invisiblefarm.it (without /harbor)." />
          <Form.TextField id="baseUrl" title="Registry Base URL" placeholder="https://registry.invisiblefarm.it" />
          <Form.TextField id="username" title="Registry Username" placeholder="username" />
          <Form.PasswordField id="password" title="Registry Password / Token" />
          <Form.TextField id="defaultProject" title="Default Project (Optional)" placeholder="project-name" />
        </>
      ) : (
        <>
          <Form.Description text="Docker Hub support is in beta: search/list is available, scan/delete can be unavailable by API policy." />
          <Form.TextField id="username" title="Docker Hub Username" placeholder="username" />
          <Form.PasswordField id="password" title="Docker Hub Password / Access Token" />
          <Form.TextField id="defaultNamespace" title="Default Namespace" placeholder="organization or username" />
        </>
      )}
    </Form>
  );
}

export function EditProviderForm(props: { provider: ProviderConfig; onSaved?: () => Promise<void> | void }) {
  const { pop } = useNavigation();
  const [kind, setKind] = useState<ProviderKind>(props.provider.kind);
  const [isLoading, setIsLoading] = useState(false);

  async function onSubmit(values: {
    kind: ProviderKind;
    label?: string;
    baseUrl?: string;
    username?: string;
    password?: string;
    defaultProject?: string;
    defaultNamespace?: string;
  }) {
    setIsLoading(true);
    try {
      if (values.kind === "private-arbor" && !values.baseUrl?.trim()) {
        throw new Error("Registry Base URL is required for Private Harbor.");
      }
      if (!values.username?.trim()) {
        throw new Error("Username is required.");
      }

      const nextPassword = values.password?.trim() ? values.password : props.provider.password;
      if (!nextPassword?.trim()) {
        throw new Error("Password/Token is required.");
      }

      const config: ProviderConfig = {
        id: props.provider.id,
        kind: values.kind,
        label: buildProviderLabel(values.kind, values.label),
        baseUrl: values.kind === "private-arbor" ? values.baseUrl?.trim() : undefined,
        username: values.username?.trim(),
        password: nextPassword,
        defaultProject: values.kind === "private-arbor" ? values.defaultProject?.trim() : undefined,
        defaultNamespace: values.kind === "docker-hub" ? values.defaultNamespace?.trim() : undefined,
      };

      await updateProviderConfig(props.provider.id, config);
      await showHUD(`Provider updated: ${config.label}`);
      if (props.onSaved) await props.onSaved();
      pop();
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to update provider",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Form
      isLoading={isLoading}
      navigationTitle="Edit Provider"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Update Provider" onSubmit={onSubmit} />
        </ActionPanel>
      }
    >
      <Form.Dropdown id="kind" title="Provider" value={kind} onChange={(value) => setKind(value as ProviderKind)}>
        <Form.Dropdown.Item value="private-arbor" title="Private Harbor" icon={providerIcon("private-arbor")} />
        <Form.Dropdown.Item value="docker-hub" title="Docker Hub (Beta)" icon={providerIcon("docker-hub")} />
      </Form.Dropdown>
      <Form.TextField id="label" title="Display Name" defaultValue={props.provider.label} />
      {kind === "private-arbor" ? (
        <>
          <Form.Description text="For Harbor, use only the base URL. Example: https://registry.invisiblefarm.it (without /harbor)." />
          <Form.TextField
            id="baseUrl"
            title="Registry Base URL"
            defaultValue={props.provider.baseUrl}
            placeholder="https://registry.invisiblefarm.it"
          />
          <Form.TextField
            id="username"
            title="Registry Username"
            defaultValue={props.provider.username}
            placeholder="username"
          />
          <Form.PasswordField
            id="password"
            title="Registry Password / Token"
            placeholder="•••••••• (leave blank to keep current)"
          />
          <Form.TextField
            id="defaultProject"
            title="Default Project (Optional)"
            defaultValue={props.provider.defaultProject}
            placeholder="project-name"
          />
        </>
      ) : (
        <>
          <Form.Description text="Docker Hub support is in beta: search/list is available, scan/delete can be unavailable by API policy." />
          <Form.TextField
            id="username"
            title="Docker Hub Username"
            defaultValue={props.provider.username}
            placeholder="username"
          />
          <Form.PasswordField
            id="password"
            title="Docker Hub Password / Access Token"
            placeholder="•••••••• (leave blank to keep current)"
          />
          <Form.TextField
            id="defaultNamespace"
            title="Default Namespace"
            defaultValue={props.provider.defaultNamespace}
            placeholder="organization or username"
          />
        </>
      )}
    </Form>
  );
}

export default function Command() {
  const { data, isLoading, revalidate } = useCachedPromise(getProviderConfigs, []);
  const providers = useMemo(() => data ?? [], [data]);

  async function removeProvider(id: string, label: string) {
    await removeProviderConfig(id);
    await revalidate();
    await showHUD(`Removed ${label}`);
  }

  async function testConnection(provider: ProviderConfig) {
    await showToast({ style: Toast.Style.Animated, title: `Testing ${provider.label}...` });
    try {
      const client = createProvider(provider);
      await client.listProjects("");
      await showHUD(`Connection OK: ${provider.label}`);
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: `Connection failed: ${provider.label}`,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Manage configured providers">
      {providers.length === 0 ? (
        <List.Item
          title="No providers configured"
          subtitle="Press ⌘N to add your first provider"
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

      {providers.map((provider) => (
        <List.Item
          key={provider.id}
          icon={providerIcon(provider.kind)}
          title={provider.label}
          subtitle={provider.kind === "private-arbor" ? provider.baseUrl : "Docker Hub"}
          accessories={[
            provider.kind === "docker-hub" ? { tag: "Beta" } : { text: "" },
            provider.password ? { text: "••••••••" } : { text: "" },
          ]}
          actions={
            <ActionPanel>
              <Action.Push
                title="Add Provider"
                target={<AddProviderForm onSaved={revalidate} />}
                shortcut={{ modifiers: ["cmd"], key: "n" }}
              />
              <Action.Push
                title="Edit Provider"
                icon={Icon.Pencil}
                target={<EditProviderForm provider={provider} onSaved={revalidate} />}
              />
              <Action title="Test Connection" icon={Icon.Network} onAction={() => testConnection(provider)} />
              <Action
                title="Remove Provider"
                style={Action.Style.Destructive}
                icon={Icon.Trash}
                onAction={() => removeProvider(provider.id, provider.label)}
              />
            </ActionPanel>
          }
        />
      ))}
    </List>
  );
}
