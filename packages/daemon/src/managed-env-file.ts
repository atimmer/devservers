import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const MANAGED_ENV_START_MARKER = "# - Managed by `devservers` - Start, do not edit.";
export const MANAGED_ENV_END_MARKER = "# - Managed by `devservers` - End";

const normalizeLineEndings = (value: string) => value.replace(/\r\n/g, "\n");

const quoteEnvValue = (value: string) => {
  if (/^[A-Za-z0-9_./:@-]*$/.test(value)) {
    return value;
  }
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
};

const renderManagedBlock = (env: Record<string, string>) => {
  const lines = [MANAGED_ENV_START_MARKER];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`${key}=${quoteEnvValue(value)}`);
  }
  lines.push(MANAGED_ENV_END_MARKER);
  return lines.join("\n");
};

export const upsertManagedEnvBlock = (source: string, env: Record<string, string>) => {
  const normalized = normalizeLineEndings(source);
  const managedBlock = renderManagedBlock(env);
  const startIndex = normalized.indexOf(MANAGED_ENV_START_MARKER);
  const endIndex = normalized.indexOf(MANAGED_ENV_END_MARKER);

  if (startIndex === -1 && endIndex === -1) {
    if (normalized.length === 0) {
      return `${managedBlock}\n`;
    }
    const before = normalized.replace(/\n+$/g, "");
    return `${before}\n\n${managedBlock}\n`;
  }

  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error("Managed env block markers are malformed");
  }

  const endOffset = endIndex + MANAGED_ENV_END_MARKER.length;
  const before = normalized.slice(0, startIndex);
  const after = normalized.slice(endOffset);
  const beforeWithoutTrailingNewlines = before.replace(/\n+$/g, "");
  if (beforeWithoutTrailingNewlines.length === 0) {
    return `${managedBlock}${after}`;
  }
  return `${beforeWithoutTrailingNewlines}\n\n${managedBlock}${after}`;
};

export const writeManagedEnvFile = async (
  envFilePath: string,
  env: Record<string, string> | undefined
) => {
  let current = "";
  try {
    current = await readFile(envFilePath, "utf-8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }

  const next = upsertManagedEnvBlock(current, env ?? {});
  await mkdir(path.dirname(envFilePath), { recursive: true });
  await writeFile(envFilePath, next, "utf-8");
};
