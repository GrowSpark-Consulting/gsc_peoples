import { expect, type Page } from '@playwright/test';

/**
 * Government ID test data. Fictitious numbers that only pass the FORMAT checks (the Aadhaar one carries a valid
 * Verhoeff check digit). Shared by every live-mode suite that adds an employee through the form, because the
 * identity section is mandatory there.
 */
export const TEST_AADHAAR = '234567890124';
export const TEST_AADHAAR_2 = '987654321096';
export const TEST_PAN = 'ABCPE1234F';
export const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 7)]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1024)]);
export const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024, 3)]);

/** Fills the identity section inside `scope` (the Add employee page or a profile upload form). */
export async function fillIdentity(page: Page, o: { type?: 'AADHAAR' | 'PAN'; number?: string; audience?: 'hr' | 'self' } = {}) {
  const type = o.type ?? 'AADHAAR';
  await page.getByRole('combobox', { name: /Document type/ }).selectOption(type);
  await page.getByLabel(/^Document number/).fill(o.number ?? (type === 'PAN' ? TEST_PAN : TEST_AADHAAR));
  const files = page.locator('input[type=file]');
  await files.nth(0).setInputFiles({ name: 'front.jpg', mimeType: 'image/jpeg', buffer: JPG });
  if (type !== 'PAN') await files.nth(1).setInputFiles({ name: 'back.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByText('front.jpg')).toBeVisible();
  await page.getByLabel(o.audience === 'self' ? /I have read this notice/ : /The employee has been given this notice/).check();
}
