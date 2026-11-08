import { expect, test } from "../support/fixtures";
import { gotoAppShell } from "../support/helpers/app";
import { seedWorkspace } from "../support/helpers/seed-client";
import { getServerId } from "../support/helpers/server-id";
import { openSettingsSection } from "../support/helpers/settings";

test("shows Pure black in the appearance picker", async ({ page }, testInfo) => {
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  await expect(page.getByRole("radio", { name: "System", exact: true })).toBeChecked();
  await expect(
    page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio").first(),
  ).toHaveAccessibleName("System");
  await expect(page.getByRole("radio", { name: "Pure black", exact: true })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("appearance-theme-picker.png"),
    fullPage: true,
  });
});

test("keeps the selected workspace visible in Light", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "light-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "light" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(212, 212, 216)");
    await page.screenshot({
      path: testInfo.outputPath("light-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("keeps the selected workspace visible in Pure black", async ({ page }, testInfo) => {
  const workspace = await seedWorkspace({
    repoPrefix: "pure-black-selected-workspace-",
    title: "Selected workspace",
  });

  try {
    await page.addInitScript(() => {
      localStorage.setItem("@paseo:app-settings", JSON.stringify({ theme: "pureBlack" }));
    });
    await gotoAppShell(page);

    const row = page.getByTestId(`sidebar-workspace-row-${getServerId()}:${workspace.workspaceId}`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await row.click();

    await expect(row).toHaveAttribute("aria-selected", "true");
    await expect(row).toHaveCSS("background-color", "rgb(17, 17, 17)");
    await page.screenshot({
      path: testInfo.outputPath("pure-black-selected-workspace.png"),
      fullPage: true,
    });
  } finally {
    await workspace.cleanup();
  }
});

test("applies the interface font size to settings text", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("@paseo:app-settings", JSON.stringify({ uiBaseFontSize: 21 }));
  });
  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const sectionTitle = page.getByText("Theme", { exact: true }).first();
  await expect(sectionTitle).toHaveCSS("font-size", "18px");

  const interfaceSizeInput = page.getByLabel("Interface font size");
  const contentSizeInput = page.getByLabel("Content font size");
  await expect(interfaceSizeInput).toHaveValue("21");
  await expect(contentSizeInput).toHaveValue("21");
  await interfaceSizeInput.fill("12");
  await interfaceSizeInput.press("Tab");

  await expect(interfaceSizeInput).toHaveValue("12");
  await expect(contentSizeInput).toHaveValue("21");
  await expect(sectionTitle).toHaveCSS("font-size", "10px");
});

// The fork's spacing controls are track sliders (`components/ui/slider`), not the upstream
// percentage menus: clicking a position on the track sets the value, and the keyboard does not
// drive them. Values measured in this harness: interface padding scales linearly with
// `uiSpacingPercent` (16px at 100%), the preview line box follows `textLineHeightPercent`
// (15px at 110%, 20px at 140%, 25px at 180% over the 14px preview glyph), and block spacing moves
// neither. Prose block gaps live in the agent stream, so they are not observable on this screen.
test("adjusts and persists interface spacing and text line height independently", async ({
  page,
}, testInfo) => {
  const setSlider = async (label: string, end: "min" | "max") => {
    const input = page.getByLabel(label, { exact: true });
    const box = await input.boundingBox();
    if (!box) throw new Error(`Missing spacing slider: ${label}`);
    await input.click({
      force: true,
      position: { x: end === "min" ? 1 : box.width - 1, y: box.height / 2 },
    });
  };

  await page.goto("/settings");
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");

  const sample = page.getByText("Readable content and code preview", { exact: true });
  const interfaceRow = page.getByText("Interface spacing", { exact: true }).locator("../..");
  await expect(interfaceRow).toHaveCSS("padding-top", "16px");
  await expect(sample).toHaveCSS("font-size", "14px");
  await expect(sample).toHaveCSS("line-height", "20px");

  await setSlider("Interface spacing", "min");
  await expect(interfaceRow).toHaveCSS("padding-top", "8px");
  await expect(sample).toHaveCSS("line-height", "20px");

  await setSlider("Interface spacing", "max");
  await expect(interfaceRow).toHaveCSS("padding-top", "20px");

  await setSlider("Line height", "min");
  await expect(sample).toHaveCSS("line-height", "15px");
  await expect(interfaceRow).toHaveCSS("padding-top", "20px");

  await setSlider("Line height", "max");
  await expect(sample).toHaveCSS("line-height", "25px");

  await setSlider("Paragraph and block spacing", "min");
  await expect(sample).toHaveCSS("line-height", "25px");
  await expect(sample).toHaveCSS("font-size", "14px");
  await expect(interfaceRow).toHaveCSS("padding-top", "20px");

  await page.reload();
  await expect(page.getByTestId("settings-sidebar")).toBeVisible();
  await openSettingsSection(page, "appearance");
  await expect(page.getByLabel("Interface spacing", { exact: true })).toHaveValue("125");
  await expect(page.getByLabel("Line height", { exact: true })).toHaveValue("180");
  await expect(page.getByLabel("Paragraph and block spacing", { exact: true })).toHaveValue("0");
  await expect(interfaceRow).toHaveCSS("padding-top", "20px");
  await expect(sample).toHaveCSS("line-height", "25px");
  await page.screenshot({ path: testInfo.outputPath("appearance-spacing.png"), fullPage: true });
});
