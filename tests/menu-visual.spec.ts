import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('tracker action menu is not clipped on mobile', async ({ page }) => {
  await page.goto('http://127.0.0.1:4173')
  await page.getByRole('textbox', { name: 'ton@email.com' }).fill('vincent.denizbraah@gmail.com')
  await page.getByRole('textbox', { name: 'Minimum 6 caracteres' }).fill('motdepasseopenclaw')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page.getByRole('button', { name: 'Ajouter une habitude' })).toBeVisible({ timeout: 60000 })
  const actionButton = page.getByRole('button', { name: 'Actions pour Faire du sport' }).first()
  await actionButton.click()

  await expect(page.locator('.tracker-action-menu')).toBeVisible()
  await page.screenshot({ path: 'test-results/menu-mobile.png', fullPage: false })
  await expect(page.getByRole('button', { name: 'Modifier' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Supprimer' })).toBeVisible()

  await page.screenshot({ path: 'test-results/menu-mobile.png', fullPage: false })
})
