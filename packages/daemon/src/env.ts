const SELF_PORT_TOKEN = /\$\{PORT\}|\$PORT\b/g;
const NAMED_PORT_TOKEN = /\$\{PORT:([a-zA-Z0-9._-]+)\}/g;

const isValidPort = (port: number | undefined) => {
  return typeof port === "number" && Number.isFinite(port) && port > 0 && port <= 65535;
};

export const applyPortTemplate = (
  value: string,
  port?: number,
  servicePorts?: Record<string, number | undefined>
) => {
  let resolved = value.replace(NAMED_PORT_TOKEN, (token, serviceName: string) => {
    const targetPort = servicePorts?.[serviceName];
    if (!isValidPort(targetPort)) {
      return token;
    }
    return String(targetPort);
  });

  if (!isValidPort(port)) {
    return resolved;
  }

  resolved = resolved.replace(SELF_PORT_TOKEN, String(port));
  return resolved;
};

export const resolveEnv = (
  env: Record<string, string> | undefined,
  port?: number,
  servicePorts?: Record<string, number | undefined>
) => {
  if (!env || Object.keys(env).length === 0) {
    return env;
  }

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = applyPortTemplate(value, port, servicePorts);
  }
  return resolved;
};
