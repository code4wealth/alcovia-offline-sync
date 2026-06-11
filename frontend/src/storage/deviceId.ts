import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "alcovia_device_id";

let cached: string | null = null;

function randomHex(n: number): string {
  const chars = "0123456789abcdef";
  let result = "";
  for (let i = 0; i < n; i++) {
    result += chars[Math.floor(Math.random() * 16)];
  }
  return result;
}

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  const stored = await AsyncStorage.getItem(KEY);
  if (stored) {
    cached = stored;
    return stored;
  }
  const id = `device-${randomHex(8)}`;
  await AsyncStorage.setItem(KEY, id);
  cached = id;
  return id;
}
