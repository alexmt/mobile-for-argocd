export const queryKeys = {
  applications: (serverUrl: string) => ["applications", serverUrl] as const,
  application: (serverUrl: string, namespace: string, name: string) =>
    ["application", serverUrl, namespace, name] as const,
  managedResources: (serverUrl: string, namespace: string, name: string) =>
    ["managedResources", serverUrl, namespace, name] as const,
  resourceTree: (serverUrl: string, namespace: string, name: string) =>
    ["resourceTree", serverUrl, namespace, name] as const,
};
