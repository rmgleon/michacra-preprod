import { expect, test } from '@playwright/test';
import { expectNoDemoRecords } from './no-demo-records';

test('production landing page loads without initializing demo records', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/SIP Misiones/);
  await expect(page.locator('#root')).not.toBeEmpty();
  await expectNoDemoRecords(page);
});

test('public landing page opens the documentation brought in from main', async ({ page }) => {
  await page.goto('/');
  await page.locator('button[title="Ver informe técnico e institucional del sistema"]').click();
  await expect(page.getByRole('heading', { name: 'Informe Técnico e Institucional del Sistema', exact: true })).toBeVisible();
});
