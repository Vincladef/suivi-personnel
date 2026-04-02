import { readFile } from 'node:fs/promises'
import { createSign } from 'node:crypto'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1'
const FIREBASE_AUTH_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE_BASE = 'https://www.googleapis.com/drive/v3/files'

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive'
const GOOGLE_USER_EMAIL = 'vincent.denizbraah@gmail.com'

function toBase64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function loadSecrets() {
  if (process.env.OPENCLAW_SECRETS_JSON) {
    return JSON.parse(process.env.OPENCLAW_SECRETS_JSON)
  }

  const raw = await readFile('/root/.openclaw/secrets.json', 'utf8')
  return JSON.parse(raw)
}

async function createServiceAccountAccessToken(serviceAccount, scopes) {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = toBase64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: GOOGLE_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }))
  const unsignedJwt = `${header}.${payload}`

  const signer = createSign('RSA-SHA256')
  signer.update(unsignedJwt)
  signer.end()
  const signature = signer.sign(serviceAccount.private_key)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsignedJwt}.${signature}`,
    }),
  })

  if (!response.ok) {
    throw new Error(`Service account token refresh failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function verifyFirebaseUser(idToken, apiKey) {
  const attempts = [idToken]
  const parts = idToken.split('.')
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
      const rawProviderToken = payload.firebase?.sign_in_provider === 'google.com' ? payload.identities?.['google.com']?.[0] : null
      if (rawProviderToken && typeof rawProviderToken === 'string' && rawProviderToken !== idToken) {
        attempts.push(rawProviderToken)
      }
    } catch {
      // ignore decode fallback
    }
  }

  let lastError = ''
  for (const token of attempts) {
    const response = await fetch(`${FIREBASE_AUTH_LOOKUP_URL}?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    })

    if (!response.ok) {
      lastError = `Firebase auth lookup failed (${response.status}): ${await response.text()}`
      continue
    }

    const payload = await response.json()
    const user = payload.users?.[0]
    if (user?.localId) {
      return {
        uid: user.localId,
        email: user.email ?? '',
      }
    }
  }

  throw new Error(lastError || 'Authenticated user not found.')
}

async function firestoreGetDocument(projectId, path, accessToken) {
  const response = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Firestore fetch failed for ${path} (${response.status}): ${await response.text()}`)
  }

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
  if ('mapValue' in field) {
    return Object.fromEntries(Object.entries(field.mapValue.fields ?? {}).map(([key, value]) => [key, unwrapValue(value)]))
  }
  return undefined
}

function firestoreDocumentToObject(document) {
  return Object.fromEntries(Object.entries(document.fields ?? {}).map(([key, value]) => [key, unwrapValue(value)]))
}

function encodeFirestoreValue(value) {
  if (value === null) return { nullValue: null }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map((item) => encodeFirestoreValue(item)) } }

  switch (typeof value) {
    case 'string':
      return { stringValue: value }
    case 'boolean':
      return { booleanValue: value }
    case 'number':
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
    case 'object':
      return {
        mapValue: {
          fields: Object.fromEntries(
            Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, encodeFirestoreValue(item)]),
          ),
        },
      }
    default:
      return { stringValue: String(value) }
  }
}

async function firestorePatchDocument(projectId, path, payload, accessToken) {
  const updateMask = Object.keys(payload).map((fieldPath) => `updateMask.fieldPaths=${encodeURIComponent(fieldPath)}`).join('&')
  const query = updateMask ? `?${updateMask}` : ''
  const response = await fetch(`${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${path}${query}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, encodeFirestoreValue(value)])),
    }),
  })

  if (!response.ok) {
    throw new Error(`Firestore patch failed for ${path} (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function exchangeRefreshToken({ clientId, clientSecret, refreshToken }) {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    throw new Error(`OAuth token refresh failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function createSpreadsheetMetadataSnapshot(spreadsheetId, accessToken) {
  const response = await fetch(`${SHEETS_BASE}/${spreadsheetId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error(`Spreadsheet fetch failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function createSpreadsheet(title, accessToken) {
  const response = await fetch(SHEETS_BASE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title, locale: 'fr_FR', timeZone: 'Etc/UTC' },
      sheets: [
        { properties: { title: 'Habitudes' } },
        { properties: { title: 'Performances' } },
        { properties: { title: 'Objectifs' } },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(`Spreadsheet creation failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function batchUpdateSpreadsheetValues(spreadsheetId, data, accessToken) {
  const response = await fetch(`${SHEETS_BASE}/${spreadsheetId}/values:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data,
    }),
  })

  if (!response.ok) {
    throw new Error(`Spreadsheet values update failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function styleSpreadsheet(spreadsheet, accessToken) {
  const styleByTitle = {
    Habitudes: {
      backgroundColor: { red: 0.86, green: 0.93, blue: 0.88 },
      foregroundColor: { red: 0.18, green: 0.28, blue: 0.2 },
      endIndex: 40,
    },
    Performances: {
      backgroundColor: { red: 0.88, green: 0.91, blue: 0.98 },
      foregroundColor: { red: 0.2, green: 0.25, blue: 0.42 },
      endIndex: 40,
    },
    Objectifs: {
      backgroundColor: { red: 0.98, green: 0.91, blue: 0.84 },
      foregroundColor: { red: 0.39, green: 0.24, blue: 0.16 },
      endIndex: 20,
    },
  }

  const requests = (spreadsheet.sheets ?? []).flatMap((sheet) => {
    const title = sheet.properties?.title
    const sheetId = sheet.properties?.sheetId
    const style = title ? styleByTitle[title] : null
    if (sheetId == null || !style) return []

    return [
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: style.backgroundColor,
              textFormat: { bold: true, foregroundColor: style.foregroundColor },
              horizontalAlignment: 'CENTER',
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
        },
      },
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId,
            dimension: 'COLUMNS',
            startIndex: 0,
            endIndex: style.endIndex,
          },
        },
      },
    ]
  })

  if (requests.length === 0) return null

  const response = await fetch(`${SHEETS_BASE}/${spreadsheet.spreadsheetId}:batchUpdate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  })

  if (!response.ok) {
    throw new Error(`Spreadsheet styling failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

async function shareSpreadsheet(spreadsheetId, email, accessToken) {
  if (!email) return null

  const response = await fetch(`${DRIVE_BASE}/${spreadsheetId}/permissions?supportsAllDrives=true&sendNotificationEmail=false`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'user',
      role: 'writer',
      emailAddress: email,
    }),
  })

  if (response.status === 409) return null
  if (!response.ok) {
    const message = await response.text()
    if (message.includes('already has')) return null
    throw new Error(`Spreadsheet sharing failed (${response.status}): ${message}`)
  }

  return response.json()
}

function normalizeAppState(state) {
  return {
    trackerItems: Array.isArray(state?.trackerItems) ? state.trackerItems : [],
    occurrences: Array.isArray(state?.occurrences) ? state.occurrences : [],
    goals: Array.isArray(state?.goals) ? state.goals : [],
    goalPeriodNotes: state?.goalPeriodNotes && typeof state.goalPeriodNotes === 'object' ? state.goalPeriodNotes : {},
  }
}

function responseLabel(kind, target, entry) {
  if (!entry) return ''
  if (entry.state === 'rest') return 'Repos'
  if (entry.state === 'inactive') return 'Non concerne'
  if (kind === 'tristate') {
    return {
      success: 'Oui',
      failed: 'Non',
      excused: 'Neutre',
      unknown: '',
    }[entry.state] ?? ''
  }
  if (kind === 'score') {
    return {
      4: 'Oui',
      3: 'Plutot oui',
      2: 'Neutre',
      1: 'Plutot non',
      0: 'Non',
    }[entry.score] ?? ''
  }
  if (kind === 'rating10') {
    return entry.score == null ? '' : `${entry.score}/10`
  }
  if (kind === 'checklist') {
    const template = Array.isArray(target) ? target : []
    if (!Array.isArray(entry.checklist) || template.length === 0) return ''
    return template.map((label, index) => {
      const value = entry.checklist[index]
      const suffix = value === 'done'
        ? 'fait'
        : value === 'failed'
          ? 'rate'
          : value === 'excused'
            ? 'excuse'
            : 'vide'
      return `${label}: ${suffix}`
    }).join(' | ')
  }
  if (kind === 'numeric') {
    if (entry.numericValue == null) return ''
    const unit = target?.unit ? ` ${target.unit}` : ''
    return `${entry.numericValue}${unit}`.trim()
  }
  if (kind === 'note') {
    return (entry.note ?? '').trim()
  }
  return ''
}

function formatSubItems(subItems, subEntries) {
  if (!Array.isArray(subItems) || subItems.length === 0) return ''
  return subItems.map((subItem) => {
    const entry = subEntries?.[subItem.id]
    const label = responseLabel(subItem.inputKind, subItem.inputKind === 'checklist' ? subItem.checklistTemplate : subItem.target, entry)
    return `${subItem.title}: ${label || 'vide'}`
  }).join(' || ')
}

function formatSubItemDefinitions(subItems) {
  if (!Array.isArray(subItems) || subItems.length === 0) return ''
  return subItems.map((subItem) => subItem.title ?? '').filter(Boolean).join(' || ')
}

function categoryName(item) {
  return (item?.category ?? '').trim() || 'Autres'
}

function occurrenceLabel(module, occurrence) {
  if (module === 'habits') return occurrence?.date ?? occurrence?.label ?? ''
  return occurrence?.label ?? `Iteration ${occurrence?.key ?? ''}`.trim()
}

function buildTrackerRows(module, state) {
  const items = state.trackerItems
    .filter((item) => item.module === module)
    .sort((left, right) => {
      const categoryCompare = categoryName(left).localeCompare(categoryName(right), 'fr', { sensitivity: 'base' })
      if (categoryCompare !== 0) return categoryCompare
      return (left.title ?? '').localeCompare(right.title ?? '', 'fr', { sensitivity: 'base' })
    })

  const occurrences = state.occurrences
    .filter((occurrence) => occurrence.module === module && occurrence.kind === 'standard')
    .sort((left, right) => (right.key ?? 0) - (left.key ?? 0))

  const headers = ['Categorie', 'Consigne', 'Sous-consignes', ...occurrences.map((occurrence) => occurrenceLabel(module, occurrence))]
  const rows = items.map((item) => {
    const base = [
      categoryName(item),
      item.title ?? '',
      formatSubItemDefinitions(item.subItems),
    ]

    const values = occurrences.map((occurrence) => {
      const entry = occurrence.entries?.[item.id]
      const mainLabel = responseLabel(item.inputKind, item.inputKind === 'checklist' ? item.checklistTemplate : item.target, entry)
      const subLabel = formatSubItems(item.subItems, entry?.subEntries)
      if (mainLabel && subLabel) return `${mainLabel} || ${subLabel}`
      return mainLabel || subLabel || ''
    })

    return [...base, ...values]
  })

  return [headers, ...rows]
}

function goalHorizonLabel(horizon) {
  return {
    week: 'Semaine',
    month: 'Mois',
    quarter: 'Trimestre',
    year: 'Annee',
    life: 'Vie',
  }[horizon] ?? horizon ?? ''
}


function goalCategoryName(goal) {
  return goal.horizon === 'week'
    ? `Semaines · ${goal.weekDate ?? goal.dueDate ?? ''}`
    : goal.horizon === 'month'
      ? 'Mois'
      : goal.horizon === 'year'
        ? 'Annees'
        : 'Autres'
}

function formatGoalSubObjectives(goal) {
  if (!Array.isArray(goal?.subItems) || goal.subItems.length === 0) return ''
  return goal.subItems.map((subItem) => {
    const entry = goal.subEntries?.[subItem.id]
    const label = responseLabel(
      subItem.inputKind,
      subItem.inputKind === 'checklist' ? subItem.checklistTemplate : subItem.target,
      entry,
    )
    return `${subItem.title}: ${label || 'vide'}`
  }).join(' || ')
}

function buildGoalPeriodNoteRows(state) {
  const entries = Object.entries(state.goalPeriodNotes ?? {})
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .sort(([left], [right]) => left.localeCompare(right, 'fr', { sensitivity: 'base' }))

  return entries.map(([key, value]) => {
    const [scope, rawDate] = key.split(':')
    const label = scope === 'week'
      ? 'Note de semaine'
      : scope === 'month'
        ? 'Note de mois'
        : scope === 'year'
          ? 'Note d annee'
          : 'Note'

    return [
      label,
      rawDate ?? '',
      '',
      '',
      '',
      '',
      value.trim(),
      '',
    ]
  })
}

function buildGoalRows(state) {
  const headers = ['Categorie', 'Titre', 'Horizon', 'Echeance', 'Priorite', 'Statut', 'Valeur', 'Description', 'Sous-objectifs']
  const goalRows = [...state.goals]
    .sort((left, right) => {
      const categoryCompare = goalCategoryName(left).localeCompare(goalCategoryName(right), 'fr', { sensitivity: 'base' })
      if (categoryCompare !== 0) return categoryCompare
      const dueCompare = (left.dueDate ?? '').localeCompare(right.dueDate ?? '')
      if (dueCompare !== 0) return dueCompare
      return (left.title ?? '').localeCompare(right.title ?? '', 'fr', { sensitivity: 'base' })
    })
    .map((goal) => [
      goalCategoryName(goal),
      goal.title ?? '',
      goalHorizonLabel(goal.horizon),
      goal.dueDate ?? '',
      goal.priority ?? '',
      goal.status ?? '',
      responseLabel(goal.resultKind, goal.resultKind === 'checklist' ? goal.checklistTemplate : goal.target, {
        state: goal.status,
        score: goal.score,
        checklist: goal.checklist,
        numericValue: goal.numericValue,
        note: goal.note,
      }),
      goal.description ?? '',
      formatGoalSubObjectives(goal),
    ])

  const noteRows = buildGoalPeriodNoteRows(state)
  return [headers, ...goalRows, ...(noteRows.length > 0 ? [['', '', '', '', '', '', '', '', ''], ...noteRows.map((row) => [...row, ''])] : [])]
}

function buildSpreadsheetPayload(state) {
  return [
    { range: 'Habitudes!A1', values: buildTrackerRows('habits', state) },
    { range: 'Performances!A1', values: buildTrackerRows('performances', state) },
    { range: 'Objectifs!A1', values: buildGoalRows(state) },
  ]
}

function sheetUrlFromId(spreadsheetId) {
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed.' })
  }

  try {
    const authHeader = request.headers.get('authorization') || ''
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
    if (!idToken) {
      return json(401, { ok: false, error: 'Missing Firebase ID token.' })
    }

    const secrets = await loadSecrets()
    const apiKey = 'AIzaSyD2qFbsiTYj4kEY3TZ2wjEFgSTe_yngasw'
    const serviceAccount = secrets.integrations?.firebase?.serviceAccount
    const projectId = serviceAccount?.project_id || secrets.integrations?.google?.oauth?.projectId
    const googleOauth = secrets.integrations?.google?.oauth
    const googleAccount = secrets.integrations?.google?.accounts?.[GOOGLE_USER_EMAIL]

    if (!apiKey || !serviceAccount || !projectId || !googleOauth?.clientId || !googleOauth?.clientSecret || !googleAccount?.refreshToken) {
      throw new Error('Missing Google or Firebase configuration.')
    }

    const authUser = await verifyFirebaseUser(idToken, apiKey)
    const serviceToken = await createServiceAccountAccessToken(serviceAccount, [FIRESTORE_SCOPE])
    const googleToken = await exchangeRefreshToken({
      clientId: googleOauth.clientId,
      clientSecret: googleOauth.clientSecret,
      refreshToken: googleAccount.refreshToken,
    })

    const appStateDocument = await firestoreGetDocument(projectId, `appStates/${authUser.uid}`, serviceToken.access_token)
    const appStateData = appStateDocument ? firestoreDocumentToObject(appStateDocument) : {}
    const state = normalizeAppState(appStateData.state)
    const profileDocument = await firestoreGetDocument(projectId, `userProfiles/${authUser.uid}`, serviceToken.access_token)
    const profile = profileDocument ? firestoreDocumentToObject(profileDocument) : {}
    const existingSheet = profile.googleSheet

    if (existingSheet?.spreadsheetId && existingSheet?.url) {
      const refreshedSpreadsheet = await createSpreadsheetMetadataSnapshot(existingSheet.spreadsheetId, googleToken.access_token)
      await batchUpdateSpreadsheetValues(existingSheet.spreadsheetId, buildSpreadsheetPayload(state), googleToken.access_token)
      await styleSpreadsheet(refreshedSpreadsheet, googleToken.access_token)
      await shareSpreadsheet(existingSheet.spreadsheetId, authUser.email, googleToken.access_token)

      await firestorePatchDocument(projectId, `userProfiles/${authUser.uid}`, {
        email: authUser.email,
        updatedAt: new Date(),
        googleSheet: {
          ...existingSheet,
          spreadsheetId: existingSheet.spreadsheetId,
          url: existingSheet.url,
          lastSyncedAt: new Date().toISOString(),
        },
      }, serviceToken.access_token)

      return json(200, {
        ok: true,
        spreadsheetId: existingSheet.spreadsheetId,
        url: existingSheet.url,
        reused: true,
      })
    }

    const createdAt = new Date().toISOString()
    const spreadsheet = await createSpreadsheet(`Suivi Personnel - ${authUser.email || authUser.uid}`, googleToken.access_token)
    const spreadsheetId = spreadsheet.spreadsheetId
    const url = sheetUrlFromId(spreadsheetId)

    await batchUpdateSpreadsheetValues(spreadsheetId, buildSpreadsheetPayload(state), googleToken.access_token)
    await styleSpreadsheet(spreadsheet, googleToken.access_token)
    await shareSpreadsheet(spreadsheetId, authUser.email, googleToken.access_token)

    await firestorePatchDocument(projectId, `userProfiles/${authUser.uid}`, {
      email: authUser.email,
      updatedAt: new Date(),
      googleSheet: {
        spreadsheetId,
        url,
        createdAt,
        lastSyncedAt: createdAt,
        createdBy: 'netlify-export-google-sheet',
      },
    }, serviceToken.access_token)

    return json(200, {
      ok: true,
      spreadsheetId,
      url,
      reused: false,
    })
  } catch (error) {
    return json(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
