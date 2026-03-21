import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
})

test('starts empty in habits mode without seeded data', async ({ page }) => {
  await expect(page).toHaveTitle('Suivi personnel')
  await expect(page.getByText('Application de suivi', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Overview' })).toHaveCount(0)
  await expect(page.getByText('Aucune habitude pour le moment')).toBeVisible()
  await expect(page.getByText('0 habitudes · 0 performances · 0 objectifs')).toBeVisible()
})

test('can add a personal habit and track it on the current day without creating a day', async ({ page }) => {
  await page.locator('summary').filter({ hasText: 'Ajouter une habitude' }).click()

  await page.getByPlaceholder("Nom de l'habitude").fill('Sport')
  await page.getByPlaceholder('Consigne ou description').fill('30 minutes de mouvement volontaire.')
  await page.getByRole('button', { name: "Ajouter l'habitude" }).click()

  await expect(page.getByText('Sport', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: /samedi 21 mars 2026/i })).toBeVisible()
  await page.getByRole('button', { name: 'Valide' }).click()
  await expect(page.locator('.pill.state-success').filter({ hasText: 'Reussi' }).first()).toBeVisible()
})

test('can add a goal from the empty state and preview reminders', async ({ page }) => {
  await page.getByRole('button', { name: 'Objectifs', exact: true }).click()
  await expect(page.getByText('Aucun objectif pour le moment')).toBeVisible()
  await page.locator('summary').filter({ hasText: 'Ajouter un objectif' }).click()

  await page.getByPlaceholder("Nom de l'objectif").fill('Boucler la spec produit')
  await page.getByPlaceholder('Description').fill('Objectif ajoute depuis le test E2E.')
  await page.getByRole('button', { name: "Ajouter l'objectif" }).click()

  await expect(page.getByText('Boucler la spec produit', { exact: true })).toBeVisible()
  await page.getByLabel('Reglages objectifs').click()
  await page.getByRole('button', { name: 'Tester les rappels' }).click()
  await expect(page.getByText('Semaine · Boucler la spec produit', { exact: false })).toBeVisible()
})
