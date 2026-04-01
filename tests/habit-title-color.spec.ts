import { expect, test } from '@playwright/test'

const TEST_EMAIL = 'vincent.denizbraah@gmail.com'
const TEST_PASSWORD = 'motdepasseopenclaw'

test('capture and inspect habit title color after login', async ({ page }) => {
  await page.goto('/')

  await page.getByPlaceholder('ton@email.com').fill(TEST_EMAIL)
  await page.getByPlaceholder(/minimum 6 caracteres/i).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Se connecter' }).click()

  await expect(page.getByRole('heading', { name: 'Habitudes' })).toBeVisible({ timeout: 60000 })
  const firstTracker = page.locator('.tracker-card').first()
  await expect(firstTracker).toBeVisible({ timeout: 60000 })

  const title = firstTracker.locator('.tracker-title').first()
  const titleColor = await title.evaluate((el) => getComputedStyle(el).color)
  const titleClasses = await title.getAttribute('class')
  console.log(JSON.stringify({ titleColor, titleClasses }))

  await firstTracker.screenshot({ path: 'test-results/habit-title-color.png' })
})
