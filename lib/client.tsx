import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  getApplication,
  getManagedResource,
  getManagedResources,
  getResource,
  getResourceTree,
  listApplications,
  refreshApplication,
  streamLogs,
  syncApplication,
  watchApplication,
  watchApplications,
  type Application,
  type LogEntry,
  type SyncApplicationOptions,
} from "./api";
import { serverStorage, tokenStorage } from "./storage";

export class ArgoClient {
  constructor(
    readonly serverUrl: string,
    readonly token: string,
  ) {}

  get hostname(): string {
    try {
      return new URL(this.serverUrl).hostname;
    } catch {
      return this.serverUrl;
    }
  }

  listApplications() {
    return listApplications(this.serverUrl, this.token);
  }

  getApplication(name: string, namespace: string) {
    return getApplication(this.serverUrl, this.token, name, namespace);
  }

  refreshApplication(name: string, namespace: string, hard = false) {
    return refreshApplication(
      this.serverUrl,
      this.token,
      name,
      namespace,
      hard,
    );
  }

  syncApplication(
    name: string,
    namespace: string,
    opts: SyncApplicationOptions = {},
  ) {
    return syncApplication(this.serverUrl, this.token, name, namespace, opts);
  }

  watchApplication(
    name: string,
    namespace: string,
    resourceVersion: string,
    onEvent: (type: string, app: Application) => void,
    signal: AbortSignal,
  ) {
    return watchApplication(
      this.serverUrl,
      this.token,
      name,
      namespace,
      resourceVersion,
      onEvent,
      signal,
    );
  }

  getManagedResources(name: string, namespace: string) {
    return getManagedResources(this.serverUrl, this.token, name, namespace);
  }

  getResource(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    version: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
  ) {
    return getResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
    );
  }

  getManagedResource(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
  ) {
    return getManagedResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      kind,
      namespace,
      resourceName,
    );
  }

  getResourceTree(name: string, namespace: string) {
    return getResourceTree(this.serverUrl, this.token, name, namespace);
  }

  streamLogs(
    appName: string,
    appNamespace: string,
    namespace: string,
    podName: string | undefined,
    group: string | undefined,
    kind: string | undefined,
    resourceName: string | undefined,
    container: string,
    tail: number,
    follow: boolean,
    previous: boolean,
    onEntry: (entry: LogEntry) => void,
    onError: (err: Error) => void,
    onDone: () => void,
  ): () => void {
    return streamLogs(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      namespace,
      podName,
      group,
      kind,
      resourceName,
      container,
      tail,
      follow,
      previous,
      onEntry,
      onError,
      onDone,
    );
  }

  watchApplications(
    resourceVersion: string,
    onEvent: (type: string, app: Application) => void,
    signal: AbortSignal,
  ) {
    return watchApplications(
      this.serverUrl,
      this.token,
      resourceVersion,
      onEvent,
      signal,
    );
  }
}

const ArgoClientContext = createContext<ArgoClient | null>(null);

export function useArgoClient(): ArgoClient {
  const client = useContext(ArgoClientContext);
  if (!client)
    throw new Error("useArgoClient must be used within ArgoClientProvider");
  return client;
}

export function ArgoClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [client, setClient] = useState<ArgoClient | null>(null);

  useEffect(() => {
    Promise.all([tokenStorage.get(), serverStorage.get()]).then(
      ([token, server]) => {
        if (!token || !server) {
          router.replace("/login");
        } else {
          setClient(new ArgoClient(server, token));
        }
      },
    );
  }, [router]);

  if (!client) return null;

  return (
    <ArgoClientContext.Provider value={client}>
      {children}
    </ArgoClientContext.Provider>
  );
}
