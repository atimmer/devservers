import { z } from "zod";

export const CONFIG_ENV_VAR = "DEVSERVER_CONFIG";
export const DEFAULT_CONFIG_FILENAME = "devservers.json";
export const DAEMON_PORT = 4141;

const namePattern = /^[a-zA-Z0-9._-]+$/;

export const devServerServiceSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(namePattern, "name must be alphanumeric with ._- only"),
  cwd: z.string().min(1),
  command: z.string().min(1),
  env: z.record(z.string(), z.string()).optional(),
  port: z.number().int().positive().optional(),
  lastStartedAt: z.string().datetime().optional()
});

export const devServerConfigSchema = z.object({
  version: z.literal(1),
  services: z.array(devServerServiceSchema)
});

export type DevServerService = z.infer<typeof devServerServiceSchema>;
export type DevServerConfig = z.infer<typeof devServerConfigSchema>;

export type ServiceStatus = "stopped" | "running" | "error";

export type ServiceInfo = DevServerService & {
  status: ServiceStatus;
  message?: string;
};
