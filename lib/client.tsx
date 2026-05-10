import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  deleteResource,
  getApplication,
  getManagedResource,
  getManagedResources,
  getResource,
  getResourceTree,
  getUserInfo,
  listApplications,
  refreshApplication,
  rollbackApplication,
  streamLogs,
  syncApplication,
  watchApplication,
  watchApplications,
  watchResourceTree,
  type Application,
  type LogEntry,
  type ResourceTree,
  type SyncApplicationOptions,
  type UserInfo,
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

  get queryKeys() {
    const s = this.serverUrl;
    return {
      userInfo: () => ["userInfo", s] as const,
      applications: () => ["applications", s] as const,
      application: (namespace: string, name: string) =>
        ["application", s, namespace, name] as const,
      managedResources: (namespace: string, name: string) =>
        ["managedResources", s, namespace, name] as const,
      resourceTree: (namespace: string, name: string) =>
        ["resourceTree", s, namespace, name] as const,
      resource: (
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
          s,
          appNamespace,
          appName,
          group,
          version,
          kind,
          namespace,
          name,
        ] as const,
      managedResource: (
        appNamespace: string,
        appName: string,
        group: string | undefined,
        kind: string,
        namespace: string | undefined,
        name: string,
      ) =>
        [
          "managedResource",
          s,
          appNamespace,
          appName,
          group,
          kind,
          namespace,
          name,
        ] as const,
    };
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

  rollbackApplication(name: string, namespace: string, id: number) {
    return rollbackApplication(this.serverUrl, this.token, name, namespace, id);
  }

  getUserInfo(): Promise<UserInfo> {
    return getUserInfo(this.serverUrl, this.token);
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

  watchResourceTree(
    name: string,
    namespace: string,
    onTree: (tree: ResourceTree) => void,
    signal: AbortSignal,
  ) {
    return watchResourceTree(
      this.serverUrl,
      this.token,
      name,
      namespace,
      onTree,
      signal,
    );
  }

  deleteResource(
    appName: string,
    appNamespace: string,
    group: string | undefined,
    version: string | undefined,
    kind: string,
    namespace: string | undefined,
    resourceName: string,
    force: boolean,
    orphan: boolean,
  ): Promise<void> {
    return deleteResource(
      this.serverUrl,
      this.token,
      appName,
      appNamespace,
      group,
      version,
      kind,
      namespace,
      resourceName,
      force,
      orphan,
    );
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
        if (token === null || !server) {
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
