import { expect, test } from '@playwright/test'

test('renders the tracking application overview', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle('Suivi personnel')
  await expect(page.getByRole('heading', { level: 1, name: 'Application de suivi' })).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: 'Un seul tableau de bord pour agir, progresser et garder le cap.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Habitudes', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Performances', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Objectifs', exact: true })).toBeVisible()
})

test('can add a goal and preview reminders', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Objectifs', exact: true }).click()

  await page.getByPlaceholder("Nom de l'objectif").fill('Boucler la spec produit')
  await page.getByPlaceholder('Description').fill('Objectif ajoute depuis le test E2E.')
  await page.getByRole('button', { name: "Ajouter l'objectif" }).click()

  await expect(page.getByText('Boucler la spec produit', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Tester les rappels' }).click()
  await expect(page.getByText('Semaine · Boucler la spec produit', { exact: false })).toBeVisible()
})


test('can prepare the daily action queue from the overview', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Preparer ma journee' }).click()

  await expect(page.getByRole('heading', { level: 3, name: 'File active' })).toBeVisible()
  await expect(page.getByText('Habitude prioritaire ·', { exact: false })).toBeVisible()
  await expect(page.getByText('Objectif echeance dans 2 jour(s) · Reprendre un rythme de sport stable', { exact: false })).toBeVisible()
})
