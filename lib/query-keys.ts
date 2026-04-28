export const queryKeys = {
  applications: (serverUrl: string) => ["applications", serverUrl] as const,
  application: (serverUrl: string, namespace: string, name: string) =>
    ["application", serverUrl, namespace, name] as const,
};
