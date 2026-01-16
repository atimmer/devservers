import { access, cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const uiDist = path.join(repoRoot, "apps", "ui", "dist");
const daemonUiDist = path.join(repoRoot, "packages", "daemon", "dist", "ui");

try {
  await access(uiDist);
} catch (error) {
  throw new Error(`UI build output not found at ${uiDist}`);
}

await mkdir(daemonUiDist, { recursive: true });
await cp(uiDist, daemonUiDist, { recursive: true });
