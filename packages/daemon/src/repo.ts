import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import type { RepoInfo } from "@24letters/devservers-shared";

const repoCache = new Map<string, RepoInfo | null>();

const pathExists = async (target: string) => {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
};

const hasWorkspaceConfig = async (dir: string) => {
  const pnpmWorkspace = path.join(dir, "pnpm-workspace.yaml");
  if (await pathExists(pnpmWorkspace)) {
    return true;
  }

  const packageJsonPath = path.join(dir, "package.json");
  if (!(await pathExists(packageJsonPath))) {
    return false;
  }

  try {
    const raw = await readFile(packageJsonPath, "utf-8");
    const parsed = JSON.parse(raw) as { workspaces?: unknown };
    return Boolean(parsed.workspaces);
  } catch {
    return false;
  }
};

const findWorkspaceRoot = async (cwd: string) => {
  let current = path.resolve(cwd);
  while (true) {
    if (await hasWorkspaceConfig(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
};

const findGitRoot = async (cwd: string) => {
  try {
    const { stdout } = await execa("git", ["-C", cwd, "rev-parse", "--show-toplevel"]);
    const root = stdout.trim();
    return root || undefined;
  } catch {
    return undefined;
  }
};

export const resolveRepoInfo = async (cwd: string): Promise<RepoInfo | undefined> => {
  const resolved = path.resolve(cwd);
  const cached = repoCache.get(resolved);
  if (cached !== undefined) {
    return cached ?? undefined;
  }

  const workspaceRoot = await findWorkspaceRoot(resolved);
  const root = workspaceRoot ?? (await findGitRoot(resolved));
  if (!root) {
    repoCache.set(resolved, null);
    return undefined;
  }

  const workspace = path.relative(root, resolved) || ".";
  const info: RepoInfo = {
    root,
    name: path.basename(root),
    workspace
  };
  repoCache.set(resolved, info);
  return info;
};
