import { expect, test } from "@playwright/test";

test("home redirects to project workbench", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "项目控制台" })).toBeVisible();
});

test("projects page renders two-column workbench", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目控制台" })).toBeVisible();
  await expect(page.getByText("启动与环境地址")).toBeVisible();
  await expect(page.getByText("下一步指导（Codex CLI）")).toBeVisible();
  await expect(page.getByRole("button", { name: "本地调试启动" })).toBeVisible();
});

test("workbench supports sort and git sections", async ({ page }) => {
  await page.goto("/projects");
  await page.getByLabel("排序").selectOption("relationScore");
  await expect(page.getByText("版本演进（Git）")).toBeVisible();
  await expect(page.getByRole("button", { name: /同步 GitHub|刷新状态/ })).toBeVisible();
});

test("workbench codex panel includes plan/model/reasoning controls", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByLabel("当前模型")).toBeVisible();
  await expect(page.getByLabel("推理深度")).toBeVisible();
  await expect(page.getByLabel("Plan mode（先给计划再执行）")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送到 Codex CLI" })).toBeVisible();
});

test("workbench offers root open and screenshot sections", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.getByText("界面与交互")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开项目根目录" })).toBeVisible();
  await expect(page.getByText("路径：")).toBeVisible();
});
