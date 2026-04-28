export const queryKeys = {
  applications: (serverUrl: string) => ["applications", serverUrl] as const,
  application: (serverUrl: string, namespace: string, name: string) =>
    ["application", serverUrl, namespace, name] as const,
  managedResources: (serverUrl: string, namespace: string, name: string) =>
    ["managedResources", serverUrl, namespace, name] as const,
  resourceTree: (serverUrl: string, namespace: string, name: string) =>
    ["resourceTree", serverUrl, namespace, name] as const,
  resource: (
    serverUrl: string,
    appNamespace: string,
    appName: string,
    group: string | undefined,
    version: string | undefined,
    kind: string,
    namespace: string | undefined,
    name: string,
  ) =>
    [
      "resource",
      serverUrl,
      appNamespace,
      appName,
      group,
      version,
      kind,
      namespace,
      name,
    ] as const,
  managedResource: (
    serverUrl: string,
    appNamespace: string,
    appName: string,
    group: string | undefined,
    kind: string,
    namespace: string | undefined,
    name: string,
  ) =>
    [
      "managedResource",
      serverUrl,
      appNamespace,
      appName,
      group,
      kind,
      namespace,
      name,
    ] as const,
};
