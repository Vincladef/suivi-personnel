import { test, expect } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

test('production mobile menu works and is visible', async ({ page }) => {
  await page.goto('https://suivi-personnel-app.netlify.app')
  await page.getByRole('textbox', { name: 'ton@email.com' }).fill('vincent.denizbraah@gmail.com')
  await page.getByRole('textbox', { name: 'Minimum 6 caracteres' }).fill('motdepasseopenclaw')
  await page.getByRole('button', { name: 'Se connecter' }).click()

  const actionButton = page.getByRole('button', { name: 'Actions pour Faire du sport' }).first()
  await expect(actionButton).toBeVisible({ timeout: 60000 })
  await actionButton.click()

  await expect(page.getByRole('button', { name: 'Modifier' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Supprimer' })).toBeVisible()
  await page.screenshot({ path: 'test-results/menu-prod-check.png', fullPage: false })
})
