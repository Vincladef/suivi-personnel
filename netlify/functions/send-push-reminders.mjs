import { readFile } from 'node:fs/promises'
import { createSign } from 'node:crypto'
import webpush from 'web-push'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const APP_URL = 'https://suivi-personnel-app.netlify.app'
const VAPID_PUBLIC_KEY = 'BC6y1nT7x6wJQX8wY3AmvU5M8k4X2rE0xQmY8QvJfB9XnS4xY_2F5D4X8nA7cP8m6eJmY0m2Q4c5mA8d2hR7f0'
const VAPID_PRIVATE_KEY = '<VAPID_PRIVATE_KEY>'

webpush.setVapidDetails('mailto:vincent.denizbraah@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

function toBase64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function loadSecrets() {
  if (process.env.OPENCLAW_SECRETS_JSON) return JSON.parse(process.env.OPENCLAW_SECRETS_JSON)
  return JSON.parse(await readFile('/root/.openclaw/secrets.json', 'utf8'))
}

async function createServiceAccountAccessToken(serviceAccount) {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = toBase64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: FIRESTORE_SCOPE,
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }))
  const unsignedJwt = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(unsignedJwt)
  signer.end()
  const signature = signer.sign(serviceAccount.private_key).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedJwt}.${signature}`,
    }),
  })
  if (!response.ok) throw new Error(`Service account token refresh failed (${response.status}): ${await response.text()}`)
  return response.json()
}

function unwrapValue(field) {
  if (!field || typeof field !== 'object') return undefined
  if ('stringValue' in field) return field.stringValue
  if ('booleanValue' in field) return field.booleanValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('doubleValue' in field) return Number(field.doubleValue)
  if ('timestampValue' in field) return field.timestampValue
  if ('nullValue' in field) return null
  if ('arrayValue' in field) return (field.arrayValue.values ?? []).map((value) => unwrapValue(value))
  if ('mapValue' in field) return Object.fromEntries(Object.entries(field.mapValue.fields ?? {}).map(([k, v]) => [k, unwrapValue(v)]))
  return undefined
}

function firestoreDocumentToObject(document) {
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, unwrapValue(value)]))
}

function encodeFirestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => encodeFirestoreValue(item)) } }
  switch (typeof value) {
    case 'string': return { stringValue: value }
    case 'boolean': return { booleanValue: value }
    case 'number': return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    case 'object': return { mapValue: { fields: Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, encodeFirestoreValue(v)])) } }
    default: return { stringValue: String(value) }
  }
}

async function firestoreListDocuments(projectId, path, accessToken) {
  const response = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`Firestore list failed for ${path} (${response.status}): ${await response.text()}`)
  const payload = await response.json()
  return payload.documents ?? []
}

async function firestoreGetDocument(projectId, path, accessToken) {
  const response = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Firestore get failed for ${path} (${response.status}): ${await response.text()}`)
  return response.json()
}

async function firestorePatchDocument(projectId, path, payload, accessToken) {
  const updateMask = Object.keys(payload).map((fieldPath) => `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`).join('&')
  const response = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${path}?${updateMask}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(payload).map(([k,v]) => [k, encodeFirestoreValue(v)])) }),
  })
  if (!response.ok) throw new Error(`Firestore patch failed for ${path} (${response.status}): ${await response.text()}`)
  return response.json()
}

function formatLocalDate(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

function formatLocalTime(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now)
  const get = (type) => parts.find((part) => part.type === type)?.value || '00'
  return `${get('hour')}:${get('minute')}`
}

function isHabitActive(item, date) {
  const day = new Date(`${date}T00:00:00`).getDay()
  if (!item?.frequency || item.frequency.kind === 'daily') return true
  if (item.frequency.kind === 'weekdays') return day >= 1 && day <= 5
  return (item.frequency.days ?? []).includes(day)
}

function daysBetween(fromDate, toDate) {
  const start = new Date(`${fromDate}T12:00:00Z`)
  const end = new Date(`${toDate}T12:00:00Z`)
  return Math.round((end.getTime() - start.getTime()) / 86400000)
}

function latestSuccessDateForHabit(itemId, occurrences) {
  return (occurrences ?? [])
    .filter((occurrence) => occurrence?.module === 'habits' && occurrence?.kind === 'standard' && occurrence?.date)
    .sort((left, right) => (right.key ?? 0) - (left.key ?? 0))
    .find((occurrence) => occurrence.entries?.[itemId]?.state === 'success')?.date ?? null
}

function dueTodayGoalCount(goals, today) {
  return (goals ?? []).filter((goal) => goal?.dueDate === today).length
}

function dueTodayHabitCount(items, occurrences, today) {
  return (items ?? []).filter((item) => {
    if (item?.module !== 'habits') return false
    if (!isHabitActive(item, today)) return false
    const lastSuccess = latestSuccessDateForHabit(item.id, occurrences)
    const inRest = lastSuccess && Number(item.restAfterSuccess || 0) > 0 && daysBetween(lastSuccess, today) > 0 && daysBetween(lastSuccess, today) <= Number(item.restAfterSuccess || 0)
    return !inRest
  }).length
}

function extractLatestTrackingDate(state) {
  const dates = []
  for (const occurrence of state?.occurrences ?? []) {
    if (!occurrence?.date) continue
    const entries = Object.values(occurrence.entries ?? {})
    if (entries.some((entry) => entry?.state && entry.state !== 'unknown' && entry.state !== 'rest' && entry.state !== 'inactive')) {
      dates.push(occurrence.date)
    }
  }
  for (const goal of state?.goals ?? []) {
    if (goal?.status && goal.status !== 'unknown' && goal?.dueDate) dates.push(goal.dueDate)
  }
  return dates.sort().at(-1) ?? null
}

function shouldSendNow(settings, meta, now) {
  const timeZone = settings.timezone || 'UTC'
  const localDate = formatLocalDate(now, timeZone)
  const localTime = formatLocalTime(now, timeZone)
  const target = settings.dailyReminderTime || '07:00'
  const [hh, mm] = target.split(':').map(Number)
  const [nowH, nowM] = localTime.split(':').map(Number)
  const withinWindow = nowH === hh && Math.abs(nowM - mm) <= 14
  const alreadySent = meta?.lastDailyReminderDate === localDate
  return { localDate, withinWindow: withinWindow && !alreadySent }
}

function buildNotificationBody({ habitCount, goalCount, inactiveDays, mode }) {
  if (mode === 'inactive') {
    return {
      title: 'Ton suivi t attend',
      body: `Tu n as rien renseigne depuis ${inactiveDays} jours. Reprends ton rythme aujourd hui.`,
    }
  }
  return {
    title: 'Suivi du jour',
    body: `${habitCount} habitudes et ${goalCount} objectifs a renseigner aujourd hui.`,
  }
}

export default async function handler() {
  try {
    const secrets = await loadSecrets()
    const serviceAccount = secrets.integrations?.firebase?.serviceAccount
    const projectId = serviceAccount?.project_id || 'sacred-result-490618-r4'
    if (!serviceAccount) throw new Error('Missing Firebase service account.')
    const token = await createServiceAccountAccessToken(serviceAccount)
    const profiles = await firestoreListDocuments(projectId, 'userProfiles', token.access_token)
    const now = new Date()

    for (const profileDoc of profiles) {
      const profile = firestoreDocumentToObject(profileDoc)
      const uid = profileDoc.name.split('/').at(-1)
      const settings = profile.notificationSettings || {}
      const meta = profile.notificationMeta || {}
      if (!uid || !settings.enabled) continue

      const { localDate, withinWindow } = shouldSendNow(settings, meta, now)
      const stateDoc = await firestoreGetDocument(projectId, `appStates/${uid}`, token.access_token)
      const state = stateDoc ? firestoreDocumentToObject(stateDoc).state || {} : {}
      const lastTrackingDate = extractLatestTrackingDate(state)
      const habitCount = dueTodayHabitCount(state.trackerItems, state.occurrences, localDate)
      const goalCount = dueTodayGoalCount(state.goals, localDate)
      const trackedToday = lastTrackingDate === localDate
      const inactiveDays = lastTrackingDate ? daysBetween(lastTrackingDate, localDate) : 999

      let mode = null
      const quietDays = Number(settings.quietDaysAfterTracking ?? 1)
      const recentlyTracked = lastTrackingDate ? daysBetween(lastTrackingDate, localDate) < quietDays : false
      if (withinWindow && !recentlyTracked && (habitCount > 0 || goalCount > 0)) {
        mode = 'daily'
      }
      if (!mode && settings.inactiveReminderEnabled && inactiveDays >= Number(settings.inactiveDaysThreshold || 3) && meta.lastInactiveReminderDate !== localDate) {
        mode = 'inactive'
      }
      if (!mode) continue

      const subscriptionsDocs = await firestoreListDocuments(projectId, `userProfiles/${uid}/pushSubscriptions`, token.access_token)
      const payload = buildNotificationBody({ habitCount, goalCount, inactiveDays, mode })

      for (const subscriptionDoc of subscriptionsDocs) {
        const subscription = firestoreDocumentToObject(subscriptionDoc)
        if (!subscription.enabled || !subscription.endpoint) continue
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: subscription.keys,
          }, JSON.stringify({ ...payload, url: APP_URL }))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (message.includes('410') || message.includes('404')) {
            await firestorePatchDocument(projectId, `userProfiles/${uid}/pushSubscriptions/${subscriptionDoc.name.split('/').at(-1)}`, { enabled: false }, token.access_token)
          }
        }
      }

      await firestorePatchDocument(projectId, `userProfiles/${uid}`, {
        notificationMeta: {
          ...meta,
          ...(mode === 'daily' ? { lastDailyReminderDate: localDate } : {}),
          ...(mode === 'inactive' ? { lastInactiveReminderDate: localDate } : {}),
          lastEvaluatedAt: now.toISOString(),
        },
      }, token.access_token)
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Push reminder failed.' }) }
  }
}
