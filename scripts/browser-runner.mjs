import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { chromium } from '@playwright/test'

function getArg(name) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return null
  }

  return process.argv[index + 1] ?? null
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 50) || 'page'
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function loadActions(actionsPath) {
  if (!actionsPath) {
    return []
  }

  const raw = await fs.readFile(actionsPath, 'utf8')
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('The actions file must contain a JSON array.')
  }

  return parsed
}

async function saveShot(page, outputDir, name) {
  const filePath = path.join(outputDir, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: true })
  return filePath
}

async function runAction(page, action, index, outputDir) {
  const stepName = `${String(index + 1).padStart(2, '0')}-${action.type}`

  switch (action.type) {
    case 'click':
      await page.locator(action.selector).click()
      break
    case 'fill':
      await page.locator(action.selector).fill(action.value ?? '')
      break
    case 'press':
      await page.locator(action.selector).press(action.key)
      break
    case 'waitFor':
      await page.locator(action.selector).waitFor({ state: action.state ?? 'visible' })
      break
    case 'goto':
      await page.goto(action.url, { waitUntil: action.waitUntil ?? 'networkidle' })
      break
    case 'screenshot':
      break
    case 'select':
      await page.locator(action.selector).selectOption(action.value)
      break
    case 'wait':
      await page.waitForTimeout(action.timeout ?? 1000)
      break
    default:
      throw new Error(`Unsupported action type: ${action.type}`)
  }

  return saveShot(page, outputDir, stepName)
}

const url = getArg('--url')
const actionsPath = getArg('--actions')
const outputRoot = getArg('--output') ?? 'artifacts/browser'
const runName = getArg('--name')

if (!url) {
  console.error('Usage: npm run browser:run -- --url <https://example.com> [--actions path/to/actions.json] [--output artifacts/browser]')
  process.exit(1)
}

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1024 } })
const outputDir = path.join(
  outputRoot,
  runName ? slugify(runName) : `${new Date().toISOString().replace(/[:.]/g, '-')}-${slugify(url)}`,
)
const actions = await loadActions(actionsPath)

await ensureDir(outputDir)

try {
  await page.goto(url, { waitUntil: 'networkidle' })

  const shots = []
  shots.push(await saveShot(page, outputDir, '00-initial'))

  for (const [index, action] of actions.entries()) {
    shots.push(await runAction(page, action, index, outputDir))
  }

  const summary = {
    url: page.url(),
    title: await page.title(),
    outputDir,
    screenshots: shots,
  }

  await fs.writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
} finally {
  await browser.close()
}
