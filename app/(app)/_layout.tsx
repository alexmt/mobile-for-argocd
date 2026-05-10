import { Stack, router } from "expo-router";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ArgoClientProvider } from "../../lib/client";
import { ResourceFilterProvider } from "../../components/resource-filter";

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof Error && error.message === "Unauthorized") {
        router.replace("/login");
      }
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 0,
      gcTime: 0,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function AppLayout() {
  return (
    <ArgoClientProvider>
      <QueryClientProvider client={queryClient}>
        <ResourceFilterProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ResourceFilterProvider>
      </QueryClientProvider>
    </ArgoClientProvider>
  );
}
