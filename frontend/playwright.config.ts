import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const backendPort = 8010;
const frontendPort = 5174;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(currentDir, ".e2e");

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://127.0.0.1:${frontendPort}`,
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: `python -m uvicorn app.main:app --host 127.0.0.1 --port ${backendPort}`,
      cwd: path.resolve(currentDir, "../backend"),
      env: {
        SCENE_STAGER_DB_PATH: path.join(e2eRoot, "scene_stager_e2e.db"),
        SCENE_STAGER_UPLOAD_DIR: path.join(e2eRoot, "uploads"),
        SCENE_STAGER_CORS_ORIGINS: `http://127.0.0.1:${frontendPort}`,
      },
      url: `http://127.0.0.1:${backendPort}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
      cwd: currentDir,
      env: {
        VITE_API_URL: `http://127.0.0.1:${backendPort}`,
      },
      url: `http://127.0.0.1:${frontendPort}`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
