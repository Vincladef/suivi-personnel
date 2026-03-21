import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/')
})

test('starts empty in habits mode without seeded data', async ({ page }) => {
  await expect(page).toHaveTitle('Suivi personnel')
  await expect(page.getByRole('heading', { name: 'Habitudes' })).toBeVisible()
  await expect(page.getByText('Aucune habitude')).toBeVisible()
  await expect(page.getByText('0 habitudes · 0 performances · 0 objectifs')).toHaveCount(0)
})

test('can add a personal habit and track it on the current day without creating a day', async ({ page }) => {
  await page.getByRole('button', { name: 'Ajouter une habitude' }).click()

  await page.getByPlaceholder('Titre').fill('Sport')
  await page.getByPlaceholder('Description').fill('30 minutes de mouvement volontaire.')
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  await expect(page.getByText('Sport', { exact: true })).toBeVisible()
  await expect(page.getByText(/samedi 21 mars 2026/i)).toBeVisible()
  await page.getByRole('button', { name: /Renseigner Sport/i }).click()
  await page.getByLabel('Reponse').selectOption('yes')
  await page.getByRole('button', { name: 'Valider', exact: true }).click()
  await expect(page.locator('.pill.state-success').filter({ hasText: 'Oui' }).first()).toBeVisible()
})

test('can add a goal from the empty state', async ({ page }) => {
  await page.getByRole('button', { name: 'Ouvrir le menu' }).click()
  await page.getByRole('button', { name: 'Objectifs', exact: true }).click()
  await expect(page.getByText('Aucun objectif')).toBeVisible()
  await page.getByRole('button', { name: 'Ajouter un objectif' }).click()

  await page.getByPlaceholder('Titre').fill('Boucler la spec produit')
  await page.getByPlaceholder('Description').fill('Objectif ajoute depuis le test E2E.')
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click()

  await expect(page.getByText('Boucler la spec produit', { exact: true })).toBeVisible()
  await expect(page.getByText(/semaine du/i)).toBeVisible()
})
