export const parseEnvVars = (entries?: string[]) => {
  if (!entries?.length) return undefined;
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const [key, ...rest] = entry.split("=");
    if (!key || rest.length === 0) throw new Error(`Invalid env entry: ${entry}`);
    env[key] = rest.join("=");
  }
  return env;
};

export const formatServiceUrl = (scheme: string, host: string, port: number, pathname = "/") => {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Cannot format URL: invalid port ${String(port)}`);
  }
  try {
    const url = new URL(`${scheme}://${host}`);
    url.port = String(port);
    url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return url.toString();
  } catch (error) {
    throw new Error(
      `Cannot format URL: ${error instanceof Error ? error.message : "invalid URL inputs"}`,
    );
  }
};

export const printResult = (value: unknown, json: boolean, human: string) => {
  console.log(json ? JSON.stringify(value) : human);
};
