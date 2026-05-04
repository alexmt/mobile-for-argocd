import { Redirect } from "expo-router";
import { useEffect, useState } from "react";
import { serverStorage, tokenStorage } from "../lib/storage";

export default function Index() {
  const [dest, setDest] = useState<"/(app)/" | "/login" | null>(null);

  useEffect(() => {
    Promise.all([tokenStorage.get(), serverStorage.get()]).then(
      ([token, server]) => {
        setDest(token !== null && server !== null ? "/(app)/" : "/login");
      },
    );
  }, []);

  if (!dest) return null;
  return <Redirect href={dest} />;
}
