import { expect, Page, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { deflateSync } from "node:zlib";

const API_BASE_URL = "http://127.0.0.1:8010";

test("milestone 4 editor flow survives real browser use", async ({ page }, testInfo) => {
  const fixturesDir = testInfo.outputPath("fixtures");
  await fs.mkdir(fixturesDir, { recursive: true });
  const panoramaPath = path.join(fixturesDir, "e2e-panorama.png");
  const sourcePath = path.join(fixturesDir, "e2e-source.png");
  const modelPath = path.join(fixturesDir, "e2e-character.glb");
  await fs.writeFile(panoramaPath, createPng(512, 256));
  await fs.writeFile(sourcePath, createPng(320, 200));
  await fs.writeFile(modelPath, createEmptyGlb());

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/");
  await page.getByLabel("Name").fill(`E2E Shot Planner ${Date.now()}`);
  await page.getByLabel("Description").fill("Playwright coverage for the 3D editor flow.");
  await page.getByRole("button", { name: "Create and open" }).click();
  await page.waitForURL(/\/projects\/\d+$/);
  const projectId = Number(page.url().split("/").pop());
  expect(projectId).toBeGreaterThan(0);

  await uploadWithButton(page, "Upload source image", sourcePath);
  await expect(page.getByText("Source preview")).toBeVisible();

  await uploadWithButton(page, "Upload panorama", panoramaPath);
  await expect(page.getByText("Texture loaded")).toBeVisible();
  const canvas = page.locator("canvas");
  await expect(canvas).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox?.width).toBeGreaterThan(500);
  expect(canvasBox?.height).toBeGreaterThan(500);
  await expect
    .poll(() => page.evaluate(() => document.body.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect.poll(() => canvasDataUrlPrefix(page)).toBe("data:image/png;base64,");

  await page.getByRole("button", { name: "Characters" }).click();
  await uploadWithButton(page, "Upload GLB", modelPath);
  await expect(page.getByText("e2e-character")).toBeVisible();
  await page.getByRole("button", { name: "Add" }).click();
  await expect
    .poll(() => listCharacterInstances(projectId).then((instances) => instances.length))
    .toBe(1);
  await expect(page.getByLabel("Selected object transform")).toBeVisible();
  await expect.poll(() => floatingTransformIsInViewer(page)).toBe(true);

  await page.getByRole("button", { name: "Shot" }).click();
  await dragCanvas(page);
  await page.getByLabel("Shot #").fill("7");
  await page.getByLabel("Shot size").selectOption("CU");
  await page.getByLabel("Camera").selectOption("orbit");
  await page.getByLabel("Zoom / FOV").fill("45");
  await page.getByLabel("Action notes").fill("Character turns toward the window.");
  await page.getByLabel("Prompt notes").fill("Moody practical lighting, consistent layout.");
  const saveStateRequest = page.waitForRequest(
    (request) =>
      request.method() === "PATCH" &&
      request.url().includes(`/api/projects/${projectId}/scene-states/`) &&
      request.postDataJSON().action_notes === "Character turns toward the window.",
  );
  await page.getByTestId("save-scene-state").click();
  const saveStatePayload = (await saveStateRequest).postDataJSON();
  expect(saveStatePayload.camera_position_x).toBeUndefined();
  expect(saveStatePayload.camera_target_x).toBeUndefined();
  expect(saveStatePayload.camera_fov).toBeUndefined();
  await page.getByTestId("drone-view").click();
  await expect(page.getByLabel("Zoom / FOV")).toHaveValue("55");
  await page.getByTestId("save-camera").click();

  const state = await firstSceneState(projectId);
  expect(state.shot_number).toBe(7);
  expect(state.shot_size).toBe("CU");
  expect(state.camera_move).toBe("orbit");
  expect(state.camera_position_y).toBe(7);
  expect(state.camera_target_y).toBe(0);
  expect(state.camera_fov).toBe(55);
  expect(state.action_notes).toBe("Character turns toward the window.");
  expect(state.prompt_notes).toBe("Moody practical lighting, consistent layout.");

  await page.getByRole("button", { name: "Export" }).click();
  await expect(page.getByText("Image reference prompt")).toBeVisible();
  await page.getByText("Image reference prompt").scrollIntoViewIfNeeded();
  await page.getByTestId("copy-image-prompt").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Create a cinematic CU frame",
  );

  const screenshotDownload = page.waitForEvent("download");
  await page.getByTestId("download-screenshot").click();
  expect((await screenshotDownload).suggestedFilename()).toBe(
    `project-${projectId}-scene-${state.id}.png`,
  );

  const jsonDownload = page.waitForEvent("download");
  await page.getByTestId("download-scene-json").click();
  expect((await jsonDownload).suggestedFilename()).toBe(
    `project-${projectId}-scene-${state.id}.json`,
  );

  const sceneExport = await fetchJson(
    `${API_BASE_URL}/api/projects/${projectId}/scene-states/${state.id}/export-json`,
  );
  expect(sceneExport.scene_state.shot_size).toBe("CU");
  expect(sceneExport.camera.position.y).toBe(7);
  expect(sceneExport.camera.target.y).toBe(0);
  expect(sceneExport.camera.fov).toBe(55);
  expect(sceneExport.character_instances).toHaveLength(1);
  expect(sceneExport.prompts.image_reference_prompt).toContain("e2e-character");

  await page.getByTestId("duplicate-scene-state").click();
  await expect.poll(() => listSceneStates(projectId).then((states) => states.length)).toBe(2);
  await expect(page.getByRole("button", { name: "Base Scene Copy" })).toBeVisible();
  const copiedState = (await listSceneStates(projectId)).find(
    (sceneState: { name: string }) => sceneState.name === "Base Scene Copy",
  );
  if (!copiedState) {
    throw new Error("Expected duplicated scene state to exist.");
  }

  await page.getByLabel("Left/Right").fill("3.25");
  await page.getByTestId(`scene-state-${state.id}`).click();
  await page.getByTestId(`scene-state-${copiedState.id}`).click();
  await expect(page.getByLabel("Left/Right")).toHaveValue("3.25");
  await expect
    .poll(() =>
      listCharacterInstances(projectId, copiedState.id).then(
        (instances) => instances[0]?.position_x,
      ),
    )
    .toBe(3.25);

  await page.reload();
  await expect(page.getByText("Texture loaded")).toBeVisible();
  await page.getByRole("button", { name: "Shot" }).click();
  await expect(page.getByLabel("Shot #")).toHaveValue("7");
  await expect(page.getByLabel("Shot size")).toHaveValue("CU");
  await expect(page.getByLabel("Camera")).toHaveValue("orbit");
  await expect(page.getByLabel("Zoom / FOV")).toHaveValue("55");

  await page.getByRole("button", { name: "Export" }).click();
  const packageDownload = page.waitForEvent("download");
  await page.getByTestId("download-project-package").click();
  expect((await packageDownload).suggestedFilename()).toBe(`project-${projectId}-export.zip`);

  expect(consoleErrors).toEqual([]);
});

async function uploadWithButton(
  page: Page,
  buttonName: string,
  filePath: string,
) {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: buttonName }).click();
  await (await chooser).setFiles(filePath);
}

async function dragCanvas(page: Page) {
  const box = await page.locator("canvas").boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.82;
  const startY = box!.y + box!.height * 0.24;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX - 180, startY + 26, { steps: 8 });
  await page.mouse.up();
}

async function canvasDataUrlPrefix(
  page: Page,
) {
  return page.locator("canvas").evaluate((canvas) =>
    (canvas as HTMLCanvasElement).toDataURL("image/png").slice(0, 22),
  );
}

async function floatingTransformIsInViewer(page: Page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".floating-transform-panel")?.getBoundingClientRect();
    const stage = document.querySelector(".viewer-stage")?.getBoundingClientRect();
    if (!panel || !stage) {
      return false;
    }
    return (
      panel.left >= stage.left &&
      panel.right <= stage.right &&
      panel.top >= stage.top &&
      panel.bottom <= stage.bottom
    );
  });
}

async function firstSceneState(projectId: number) {
  const states = await listSceneStates(projectId);
  return states[0];
}

async function listSceneStates(projectId: number) {
  return fetchJson(`${API_BASE_URL}/api/projects/${projectId}/scene-states`);
}

async function listCharacterInstances(projectId: number, sceneStateId?: number) {
  const query = sceneStateId ? `?scene_state_id=${sceneStateId}` : "";
  return fetchJson(`${API_BASE_URL}/api/projects/${projectId}/character-instances${query}`);
}

async function fetchJson(url: string) {
  const response = await fetch(url);
  expect(response.ok).toBe(true);
  return response.json();
}

function createEmptyGlb() {
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
    }),
  );
  const jsonPadding = (4 - (json.length % 4)) % 4;
  const jsonChunk = Buffer.concat([json, Buffer.alloc(jsonPadding, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length, 8);
  const chunkHeader = Buffer.alloc(8);
  chunkHeader.writeUInt32LE(jsonChunk.length, 0);
  chunkHeader.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunkHeader, jsonChunk]);
}

function createPng(width: number, height: number) {
  const rawRows: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 3);
    row[0] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = 1 + x * 3;
      row[offset] = Math.round((x / Math.max(1, width - 1)) * 255);
      row[offset + 1] = Math.round((y / Math.max(1, height - 1)) * 255);
      row[offset + 2] = 170;
    }
    rawRows.push(row);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(Buffer.concat(rawRows))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width: number, height: number) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = 8;
  buffer[9] = 2;
  buffer[10] = 0;
  buffer[11] = 0;
  buffer[12] = 0;
  return buffer;
}

function pngChunk(type: string, data: Buffer) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
