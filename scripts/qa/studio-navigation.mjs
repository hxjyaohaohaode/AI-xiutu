export async function leaveMobileTool(page) {
  const back = page.locator('.mobile-inspector-actions > button:first-child:visible');
  if (!(await back.isVisible())) return;
  await back.click();
  await back.waitFor({ state: 'hidden' });
}

export async function showEditorTopbar(page) {
  const reveal = page.locator('.mobile-inspector-actions > button[aria-pressed="false"]:visible');
  const header = page.locator('.floating-topbar:visible');
  await header.or(reveal).first().waitFor();
  if (await reveal.isVisible()) await reveal.click();
}
