const PORT_TOKEN = /\$\{PORT\}|\$PORT\b/g;

export const applyPortTemplate = (value: string, port?: number) => {
  if (!port) {
    return value;
  }
  return value.replace(PORT_TOKEN, String(port));
};

export const resolveEnv = (env: Record<string, string> | undefined, port?: number) => {
  if (!env || Object.keys(env).length === 0) {
    return env;
  }

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = applyPortTemplate(value, port);
  }
  return resolved;
};
