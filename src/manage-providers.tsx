import { Action, ActionPanel, Clipboard, Color, Form, Icon, List, showToast, Toast, useNavigation } from "@raycast/api";
import { useCachedPromise, useLocalStorage } from "@raycast/utils";
import { useMemo, useState } from "react";
import { providerIcon } from "./providers";
import { runProviderConnectionTest } from "./providers/connection-test";
import { addProviderConfig, getProviderConfigs, removeProviderConfig, updateProviderConfig } from "./providers/storage";
import { ProviderConfig, ProviderKind } from "./providers/types";

function buildProviderLabel(kind: ProviderKind, customLabel?: string): string {
  if (customLabel?.trim()) return customLabel.trim();
  return kind === "private-harbor" ? "Private Harbor" : "Docker Hub";
}

export function AddProviderForm(props: { onSaved?: () => Promise<void> | void }) {
  const { pop } = useNavigation();
  const [kind, setKind] = useState<ProviderKind>("private-harbor");
  const [isLoading, setIsLoading] = useState(false);
  const [lastTestFeedback, setLastTestFeedback] = useState<string>();
  const [lastTestLog, setLastTestLog] = useState<string>();

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
      if (values.kind === "private-harbor" && !values.baseUrl?.trim()) {
        throw new Error("Registry Base URL is required for Private Harbor.");
      }
      if (!values.username?.trim() || !values.password?.trim()) {
        throw new Error("Username and Password/Token are required.");
      }

      const config: ProviderConfig = {
        id: `${Date.now()}`,
        kind: values.kind,
        label: buildProviderLabel(values.kind, values.label),
        baseUrl: values.kind === "private-harbor" ? values.baseUrl?.trim() : undefined,
        username: values.username?.trim(),
        password: values.password,
        defaultProject: values.kind === "private-harbor" ? values.defaultProject?.trim() : undefined,
        defaultNamespace: values.kind === "docker-hub" ? values.defaultNamespace?.trim() : undefined,
      };

      const testResult = await runProviderConnectionTest(config);
      setLastTestLog(testResult.markdownLog);
      if (testResult.status === "failed") {
        const message = testResult.error ?? "Unknown connection error";
        const fix = testResult.suggestedFix ? ` Suggested fix: ${testResult.suggestedFix}` : "";
        setLastTestFeedback(`Connection test failed: ${message}.${fix}`);
        await showToast({ style: Toast.Style.Failure, title: testResult.summary, message });
        return;
      }

      setLastTestFeedback("Connection test passed.");

      await addProviderConfig(config);
      await showToast({
        style: Toast.Style.Success,
        title: `Provider added: ${config.label}`,
        message: "Connection OK",
      });
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
          {lastTestLog ? (
            <Action
              title="Copy Last Test Log"
              icon={Icon.Clipboard}
              onAction={async () => {
                await Clipboard.copy(lastTestLog);
                await showToast({ style: Toast.Style.Success, title: "Copied test log as Markdown" });
              }}
            />
          ) : null}
        </ActionPanel>
      }
    >
      <Form.Dropdown id="kind" title="Provider" value={kind} onChange={(value) => setKind(value as ProviderKind)}>
        <Form.Dropdown.Item value="private-harbor" title="Private Harbor" icon={providerIcon("private-harbor")} />
        <Form.Dropdown.Item
          value="docker-hub"
          title="Docker Hub (Coming soon)"
          icon={providerIcon("docker-hub")}
          disabled
        />
      </Form.Dropdown>
      <Form.TextField
        id="label"
        title="Display Name"
        placeholder={kind === "private-harbor" ? "Private Harbor" : "Docker Hub"}
      />
      {kind === "private-harbor" ? (
        <>
          <Form.Description text="For Private Harbor Registry, use only the base URL. Example: https://registry.acme.inc (without /harbor)." />
          <Form.TextField id="baseUrl" title="Registry Base URL" placeholder="https://registry.acme.inc" />
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
      {lastTestFeedback ? <Form.Description text={lastTestFeedback} /> : null}
    </Form>
  );
}

export function EditProviderForm(props: { provider: ProviderConfig; onSaved?: () => Promise<void> | void }) {
  const { pop } = useNavigation();
  const [kind, setKind] = useState<ProviderKind>(props.provider.kind);
  const [isLoading, setIsLoading] = useState(false);
  const [lastTestFeedback, setLastTestFeedback] = useState<string>();
  const [lastTestLog, setLastTestLog] = useState<string>();

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
      if (values.kind === "private-harbor" && !values.baseUrl?.trim()) {
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
        baseUrl: values.kind === "private-harbor" ? values.baseUrl?.trim() : undefined,
        username: values.username?.trim(),
        password: nextPassword,
        defaultProject: values.kind === "private-harbor" ? values.defaultProject?.trim() : undefined,
        defaultNamespace: values.kind === "docker-hub" ? values.defaultNamespace?.trim() : undefined,
        disabled: props.provider.disabled,
      };

      const testResult = await runProviderConnectionTest(config);
      setLastTestLog(testResult.markdownLog);
      if (testResult.status === "failed") {
        const message = testResult.error ?? "Unknown connection error";
        const fix = testResult.suggestedFix ? ` Suggested fix: ${testResult.suggestedFix}` : "";
        setLastTestFeedback(`Connection test failed: ${message}.${fix}`);
        await showToast({ style: Toast.Style.Failure, title: testResult.summary, message });
        return;
      }

      setLastTestFeedback("Connection test passed.");

      await updateProviderConfig(props.provider.id, config);
      await showToast({
        style: Toast.Style.Success,
        title: `Provider updated: ${config.label}`,
        message: "Connection OK",
      });
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
          {lastTestLog ? (
            <Action
              title="Copy Last Test Log"
              icon={Icon.Clipboard}
              onAction={async () => {
                await Clipboard.copy(lastTestLog);
                await showToast({ style: Toast.Style.Success, title: "Copied test log as Markdown" });
              }}
            />
          ) : null}
        </ActionPanel>
      }
    >
      <Form.Dropdown id="kind" title="Provider" value={kind} onChange={(value) => setKind(value as ProviderKind)}>
        <Form.Dropdown.Item value="private-harbor" title="Private Harbor" icon={providerIcon("private-harbor")} />
        <Form.Dropdown.Item
          value="docker-hub"
          title="Docker Hub (Coming soon)"
          icon={providerIcon("docker-hub")}
          disabled
        />
      </Form.Dropdown>
      <Form.TextField id="label" title="Display Name" defaultValue={props.provider.label} />
      {kind === "private-harbor" ? (
        <>
          <Form.Description text="For ACME Inc Harbor, use only the base URL. Example: https://registry.acme.inc (without /harbor)." />
          <Form.TextField
            id="baseUrl"
            title="Registry Base URL"
            defaultValue={props.provider.baseUrl}
            placeholder="https://registry.acme.inc"
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
            placeholder="Leave blank to keep current"
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
            placeholder="Leave blank to keep current"
          />
          <Form.TextField
            id="defaultNamespace"
            title="Default Namespace"
            defaultValue={props.provider.defaultNamespace}
            placeholder="organization or username"
          />
        </>
      )}
      {lastTestFeedback ? <Form.Description text={lastTestFeedback} /> : null}
    </Form>
  );
}

export default function Command() {
  const { data, isLoading, revalidate } = useCachedPromise(getProviderConfigs, []);
  const providers = useMemo(() => data ?? [], [data]);
  const { value: connectionStatusRaw, setValue: setConnectionStatusRaw } = useLocalStorage<string>(
    "provider-connection-status",
    "{}",
  );
  const connectionStatus = useMemo(() => {
    try {
      return JSON.parse(connectionStatusRaw ?? "{}") as Record<string, "success" | "failure" | "testing">;
    } catch {
      return {} as Record<string, "success" | "failure" | "testing">;
    }
  }, [connectionStatusRaw]);

  async function setConnectionStatus(providerId: string, status: "success" | "failure" | "testing") {
    await setConnectionStatusRaw(JSON.stringify({ ...connectionStatus, [providerId]: status }));
  }

  async function removeProvider(id: string, label: string) {
    await removeProviderConfig(id);
    await revalidate();
    await showToast({ style: Toast.Style.Success, title: `Removed ${label}` });
  }

  async function toggleProviderDisabled(provider: ProviderConfig) {
    const next = { ...provider, disabled: !provider.disabled };
    await updateProviderConfig(provider.id, next);
    await revalidate();
    await showToast({
      style: Toast.Style.Success,
      title: provider.disabled ? `Enabled ${provider.label}` : `Disabled ${provider.label}`,
    });
  }

  async function testConnection(provider: ProviderConfig) {
    if (provider.disabled) {
      await showToast({ style: Toast.Style.Failure, title: `Enable ${provider.label} to test connection` });
      return;
    }
    await setConnectionStatus(provider.id, "testing");
    await showToast({ style: Toast.Style.Animated, title: `Testing ${provider.label}...` });
    const testResult = await runProviderConnectionTest(provider);
    if (testResult.status === "ok") {
      await setConnectionStatus(provider.id, "success");
      await showToast({ style: Toast.Style.Success, title: `Connection OK: ${provider.label}` });
      return;
    }
    await setConnectionStatus(provider.id, "failure");
    await showToast({
      style: Toast.Style.Failure,
      title: `Connection failed: ${provider.label}`,
      message: testResult.suggestedFix
        ? `${testResult.error ?? "Unknown error"} (${testResult.suggestedFix})`
        : testResult.error ?? "Unknown error",
    });
    try {
      await Clipboard.copy(testResult.markdownLog);
      await showToast({ style: Toast.Style.Success, title: "Failure log copied to clipboard (Markdown)" });
    } catch {
      await setConnectionStatus(provider.id, "failure");
      // Ignore clipboard failures.
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
          icon={{
            source: providerIcon(provider.kind),
            tintColor: provider.disabled ? Color.SecondaryText : undefined,
          }}
          title={provider.label}
          subtitle={provider.kind === "private-harbor" ? provider.baseUrl : "Docker Hub"}
          accessories={[
            provider.disabled
              ? { text: "Disabled", icon: { source: Icon.Dot, tintColor: Color.SecondaryText } }
              : { text: "" },
            provider.kind === "docker-hub" ? { tag: "Beta" } : { text: "" },
            provider.password ? { text: "••••••••" } : { text: "" },
            connectionStatus[provider.id] === "success"
              ? { icon: { source: Icon.Dot, tintColor: Color.Green }, tooltip: "Connection OK" }
              : connectionStatus[provider.id] === "failure"
              ? { icon: { source: Icon.Dot, tintColor: Color.Red }, tooltip: "Connection failed" }
              : connectionStatus[provider.id] === "testing"
              ? { icon: { source: Icon.Dot, tintColor: Color.Orange }, tooltip: "Testing..." }
              : { text: "" },
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
              <Action
                title={provider.disabled ? "Enable Provider" : "Disable Provider"}
                icon={provider.disabled ? Icon.CheckCircle : Icon.Pause}
                onAction={() => toggleProviderDisabled(provider)}
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
