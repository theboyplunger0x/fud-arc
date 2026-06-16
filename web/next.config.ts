import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this app dir — silences the "multiple lockfiles"
  // inference warning (a stray ~/package-lock.json was being picked as root).
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
