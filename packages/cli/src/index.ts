import { readFileSync } from "node:fs";
import { access, cp, mkdir, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { DAEMON_PORT, devServerServiceSchema } from "@24letters/devservers-shared";
import { readConfig, resolveConfigPath } from "./config.js";
import { fetchDaemonServices, mutateService, runServiceAction } from "./daemon-client.js";
import { ensureDaemonRunning, registerManagerCommands } from "./manager.js";
import { formatServiceUrl, parseEnvVars, printResult } from "./service-utils.js";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version?: string };
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(packageRoot, "skills");
const pathExists = async (target: string) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const program = new Command();
program
  .name("devservers")
  .description("Local dev server manager")
  .version(packageJson.version ?? "0.0.0")
  .helpOption("-h, --help", "show command overview")
  .showHelpAfterError("(run with --help for command overview)")
  .addHelpText("after", "\nTip: run `devservers <command> --help` for command-specific options.")
  .option("-c, --config <path>", "config path")
  .option("--daemon <url>", "daemon base URL", `http://127.0.0.1:${DAEMON_PORT}`)
  .option("--json", "print machine-readable JSON", false);

const globalOptions = () => program.opts<{ config?: string; daemon: string; json: boolean }>();
const readyDaemon = async () => {
  const options = globalOptions();
  await ensureDaemonRunning(options.daemon, resolveConfigPath(options.config));
  return options;
};

program
  .command("list")
  .description("List configured services")
  .action(async () => {
    const options = globalOptions();
    const services = (await readConfig(resolveConfigPath(options.config))).services;
    if (options.json) return console.log(JSON.stringify({ services }));
    if (!services.length) return console.log("No services configured.");
    services.forEach((service) =>
      console.log(`${service.name} -> ${service.command} (${service.cwd})`),
    );
  });

program
  .command("status")
  .description("Show running status from daemon")
  .action(async () => {
    const options = await readyDaemon();
    const services = await fetchDaemonServices(options.daemon);
    if (options.json) return console.log(JSON.stringify({ services }));
    services.forEach((service) => {
      const details = [
        typeof service.port === "number" ? `port ${service.port}` : undefined,
        typeof service.exitCode === "number" ? `exit ${service.exitCode}` : undefined,
      ].filter(Boolean);
      console.log(
        `${service.name}: ${service.status}${details.length ? ` (${details.join(", ")})` : ""}`,
      );
    });
  });

program
  .command("url")
  .description("Print full local URL for a running service")
  .argument("<service>")
  .option("--scheme <scheme>", "URL scheme", "http")
  .option("--host <host>", "URL host", "localhost")
  .option("--path <path>", "URL path", "/")
  .action(async (name: string, options: { scheme: string; host: string; path: string }) => {
    const global = await readyDaemon();
    const service = (await fetchDaemonServices(global.daemon)).find((entry) => entry.name === name);
    if (!service) throw new Error(`Unknown service: ${name}`);
    if (service.status !== "running")
      throw new Error(`Service '${name}' is ${service.status}. Start it first, then retry.`);
    if (typeof service.port !== "number")
      throw new Error(`Service '${name}' is running but no port is known yet.`);
    const url = formatServiceUrl(options.scheme, options.host, service.port, options.path);
    printResult({ service: name, url }, global.json, url);
  });

program
  .command("add")
  .description("Add or update a service")
  .requiredOption("--name <name>")
  .requiredOption("--cwd <path>")
  .requiredOption("--command <command>")
  .option("--port <port>")
  .option("--port-mode <mode>", "port mode (static|detect|registry)")
  .option("--depends-on <name...>", "Service dependencies")
  .option("--env <entry...>", "Environment variables (KEY=VALUE)")
  .action(async (options) => {
    const global = await readyDaemon();
    const service = devServerServiceSchema.parse({
      name: options.name,
      cwd: options.cwd,
      command: options.command,
      port: options.port ? Number(options.port) : undefined,
      portMode: options.portMode,
      env: parseEnvVars(options.env),
      dependsOn: options.dependsOn,
    });
    const result = await mutateService(global.daemon, service.name, "PUT", service);
    printResult(result, global.json, `Saved ${service.name}`);
  });

program
  .command("remove")
  .description("Stop and remove a service")
  .argument("<name>")
  .action(async (name: string) => {
    const options = await readyDaemon();
    const result = await mutateService(options.daemon, name, "DELETE");
    printResult(result, options.json, `Removed ${name}`);
  });

registerManagerCommands(program);

program
  .command("install-skill")
  .description("Install Devservers Manager skills for your AI agent")
  .argument("[name]", "skill name (default: install all)")
  .option("--agent <name>", "agent name", "codex")
  .option("--dest <path>", "skills directory")
  .option("--dry-run", "show what would be installed", false)
  .option("--force", "overwrite existing skills", false)
  .action(async (name: string | undefined, options) => {
    if (!(await pathExists(skillsRoot)))
      throw new Error(`Skills directory not found at ${skillsRoot}`);
    const available = (await readdir(skillsRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const targets = name ? [name] : available;
    if (name && !available.includes(name))
      throw new Error(`Unknown skill '${name}'. Available: ${available.sort().join(", ")}`);
    const envKey = `${String(options.agent).toUpperCase()}_HOME`;
    const agentHome = process.env[envKey] ?? path.join(os.homedir(), `.${options.agent}`);
    const destination = path.resolve(options.dest ?? path.join(agentHome, "skills"));
    if (options.dryRun)
      return console.log(
        `Would install: ${targets.sort().join(", ")}\nDestination: ${destination}`,
      );
    await mkdir(destination, { recursive: true });
    for (const skill of targets) {
      const source = path.join(skillsRoot, skill);
      const target = path.join(destination, skill);
      if (!(await stat(source)).isDirectory()) continue;
      if ((await pathExists(target)) && !options.force) {
        console.log(`Skipping ${skill} (already exists). Use --force to overwrite.`);
        continue;
      }
      await cp(source, target, { recursive: true });
      console.log(`Installed ${skill}`);
    }
  });

const actionCommand = (
  action: "start" | "stop" | "restart",
  label: string,
  pastTense: string,
) => {
  program
    .command(action)
    .description(`${label} a service via the daemon`)
    .argument("<service>")
    .action(async (service: string) => {
      const options = await readyDaemon();
      const result = await runServiceAction(options.daemon, service, action);
      const affected = result.affected?.length ? ` (${result.affected.join(", ")})` : "";
      printResult(result, options.json, `${pastTense} ${service}${affected}`);
    });
};
actionCommand("start", "Start", "Started");
actionCommand("stop", "Stop", "Stopped");
actionCommand("restart", "Restart", "Restarted");

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
