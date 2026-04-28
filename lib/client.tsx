import React, { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  getApplication,
  listApplications,
  watchApplications,
  type Application,
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
