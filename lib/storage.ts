import AsyncStorage from "@react-native-async-storage/async-storage";

const SERVER_URL_KEY = "argocd:server-url";
const TOKEN_KEY = "argocd:token";

export const serverStorage = {
  get: () => AsyncStorage.getItem(SERVER_URL_KEY),
  set: (url: string) => AsyncStorage.setItem(SERVER_URL_KEY, url),
};

export const tokenStorage = {
  get: () => AsyncStorage.getItem(TOKEN_KEY),
  set: (token: string) => AsyncStorage.setItem(TOKEN_KEY, token),
  clear: () => AsyncStorage.removeItem(TOKEN_KEY),
};

const FAVORITES_KEY = "argocd:favorites";

export const favoritesStorage = {
  get: async (): Promise<Set<string>> => {
    const raw = await AsyncStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  },
  set: async (favs: Set<string>): Promise<void> => {
    await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(Array.from(favs)));
  },
};
