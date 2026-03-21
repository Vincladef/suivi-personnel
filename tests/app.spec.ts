import { expect, test } from '@playwright/test'

test('renders the tracking application in compact habits mode', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Suivi personnel')
  await expect(page.getByRole('heading', { level: 1, name: 'Application de suivi' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Habitudes', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Performances', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Objectifs', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Overview' })).toHaveCount(0)
})

test('can select a habit day and inspect history chips', async ({ page }) => {
  await page.goto('/')

  await page.getByLabel('Jour').fill('2026-03-21')
  await expect(page.getByText('Historique').first()).toBeVisible()
  await expect(page.getByRole('button', { name: /03-21/i }).first()).toBeVisible()
})

test('can add a goal and preview reminders from the compact UI', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Objectifs', exact: true }).click()
  await page.getByText('Ajouter un objectif').click()

  await page.getByPlaceholder("Nom de l'objectif").fill('Boucler la spec produit')
  await page.getByPlaceholder('Description').fill('Objectif ajoute depuis le test E2E.')
  await page.getByRole('button', { name: "Ajouter l'objectif" }).click()

  await expect(page.getByText('Boucler la spec produit', { exact: true })).toBeVisible()
  await page.getByLabel('Reglages objectifs').click()
  await page.getByRole('button', { name: 'Tester les rappels' }).click()
  await expect(page.getByText('Semaine · Boucler la spec produit', { exact: false })).toBeVisible()
})
