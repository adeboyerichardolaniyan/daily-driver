import { test, expect } from "@playwright/test";

test("manual draft steps stay in review until approval and survive reload", async ({ page, context }) => {
  test.skip(Boolean(process.env.TEST_PRODUCTION), "Uses Vite modules to seed an isolated local draft without an AI API call.");
  await page.goto("/");
  await page.locator('.app-shell').waitFor();
  await page.evaluate(async () => {
    const databaseModule = '/src/data/database.ts';
    const repositoryModule = '/src/data/repository.ts';
    const { db } = await import(databaseModule);
    const { WorkspaceRepository } = await import(repositoryModule);
    const repository = new WorkspaceRepository(db);
    const requestId = crypto.randomUUID();
    await repository.append([
      { type: 'ai.request', requestId, mode: 'breakdown', source: { taskId: null, title: 'Portfolio review', notes: '', doneWhen: '', existingSteps: [] } },
      { type: 'ai.ready', requestId, steps: [{ id: crypto.randomUUID(), title: 'Open the case study', notes: '', doneWhen: 'The document is open', minutes: 2 }] },
    ]);
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  const draft = page.getByRole('region', { name: 'Draft: Portfolio review' });
  await draft.getByRole('button', { name: 'Add a step', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Add a draft step' });
  await editor.getByLabel('Title', { exact: true }).fill('Ask a peer for feedback');
  await editor.getByLabel('Done when', { exact: true }).fill('Feedback request sent');
  await editor.getByRole('button', { name: 'Add to draft' }).click();
  await expect(draft.getByText('Ask a peer for feedback', { exact: true })).toBeVisible();
  await expect(draft.getByRole('button', { name: 'Approve 2 steps' })).toBeVisible();
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await expect(page.getByRole('heading', { name: 'No steps scheduled' })).toBeVisible();
  await context.setOffline(false);
  await page.reload();
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(draft.getByText('Ask a peer for feedback', { exact: true })).toBeVisible();
  await draft.getByRole('button', { name: 'Approve 2 steps' }).click();
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await expect(page.getByRole('button', { name: 'Ask a peer for feedback Portfolio review', exact: true })).toBeVisible();
});
