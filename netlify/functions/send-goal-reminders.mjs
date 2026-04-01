import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { createSign } from 'node:crypto'

const APP_URL = 'https://suivi-personnel-app.netlify.app'
const SENDER_EMAIL = 'vincent.denizbraah@gmail.com'
const USER_EMAIL = process.env.REMINDER_USER_EMAIL || SENDER_EMAIL
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1'
const IAM_SCOPE = 'https://www.googleapis.com/auth/datastore'

function escapeHtml(value = '') {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function stripHtml(value = '') {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function toBase64Url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
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

async function createServiceAccountAccessToken(serviceAccount) {
  const header = toBase64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  const payload = toBase64Url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: IAM_SCOPE,
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

async function fetchGoalState(projectId, uid, accessToken) {
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/appStates/${uid}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Firestore appStates fetch failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

function unwrapValue(field) {
  if (!field || typeof field !== 'object') return undefined
  if ('stringValue' in field) return field.stringValue
  if ('booleanValue' in field) return field.booleanValue
  if ('integerValue' in field) return Number(field.integerValue)
  if ('doubleValue' in field) return Number(field.doubleValue)
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

function horizonLabel(horizon) {
  return {
    week: 'Semaine',
    month: 'Mois',
    quarter: 'Trimestre',
    year: 'Année',
    life: 'Vie',
  }[horizon] ?? horizon
}

function humanDate(dateString) {
  if (!dateString) return 'sans date'
  const parsed = new Date(`${dateString}T12:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return dateString
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed)
}

function buildGoalReminderEmail(goal) {
  const title = escapeHtml(goal.title || 'Objectif')
  const description = goal.description ? `<p style="margin:0 0 18px;color:#475569;font-size:15px;line-height:1.6;">${escapeHtml(goal.description)}</p>` : ''
  const due = escapeHtml(humanDate(goal.dueDate))
  const horizon = escapeHtml(horizonLabel(goal.horizon))

  const html = `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:24px;background:#f1f5f9;font-family:Inter,Arial,sans-serif;color:#0f172a;">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border-radius:24px;overflow:hidden;box-shadow:0 24px 60px rgba(15,23,42,0.12);border:1px solid rgba(148,163,184,0.18);">
      <div style="padding:32px 32px 20px;background:linear-gradient(135deg,#111827 0%,#1d4ed8 100%);color:#ffffff;">
        <div style="font-size:13px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.8;font-weight:700;">Rappel objectif</div>
        <h1 style="margin:14px 0 0;font-size:28px;line-height:1.15;">${title}</h1>
      </div>
      <div style="padding:28px 32px 32px;">
        <p style="margin:0 0 16px;color:#334155;font-size:16px;line-height:1.7;">Petit rappel : tu as activé un rappel email pour cet objectif. C’est un bon moment pour l’ouvrir et avancer dessus.</p>
        ${description}
        <div style="display:grid;gap:12px;margin:0 0 28px;padding:18px;border-radius:18px;background:#f8fafc;border:1px solid rgba(148,163,184,0.2);">
          <div><span style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Horizon</span><strong style="font-size:16px;color:#0f172a;">${horizon}</strong></div>
          <div><span style="display:block;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;color:#64748b;font-weight:700;">Échéance</span><strong style="font-size:16px;color:#0f172a;">${due}</strong></div>
        </div>
        <div style="text-align:center;margin:0 0 24px;">
          <a href="${APP_URL}" style="display:inline-block;padding:15px 24px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;font-size:15px;box-shadow:0 16px 36px rgba(37,99,235,0.28);">Ouvrir l’application</a>
        </div>
        <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">Envoyé automatiquement depuis Suivi Personnel. Si tu ne veux plus recevoir ce rappel, désactive l’option <strong>Rappel</strong> dans l’objectif concerné.</p>
      </div>
    </div>
  </body>
</html>`

  const text = [
    `Rappel objectif : ${goal.title || 'Objectif'}`,
    goal.description ? stripHtml(goal.description) : '',
    `Horizon : ${horizonLabel(goal.horizon)}`,
    `Échéance : ${humanDate(goal.dueDate)}`,
    `Ouvrir l’application : ${APP_URL}`,
  ].filter(Boolean).join('\n\n')

  return { html, text }
}

function buildRawEmail({ from, to, subject, html, text }) {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(16).slice(2)}`
  return [
    `From: Suivi Personnel <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    '',
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

async function sendEmail(accessToken, raw) {
  const response = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: toBase64Url(raw) }),
  })

  if (!response.ok) {
    throw new Error(`Gmail send failed (${response.status}): ${await response.text()}`)
  }

  return response.json()
}

function isDueToday(goal, today) {
  return Boolean(goal?.reminder && goal?.dueDate === today)
}

function collectDueGoals(state, today) {
  return (state.goals ?? []).filter((goal) => isDueToday(goal, today))
}

async function loadSecrets() {
  if (process.env.OPENCLAW_SECRETS_JSON) {
    return JSON.parse(process.env.OPENCLAW_SECRETS_JSON)
  }
  const raw = await readFile('/root/.openclaw/secrets.json', 'utf8')
  return JSON.parse(raw)
}

export default async function handler() {
  try {
    const secrets = await loadSecrets()
    const google = secrets.integrations.google
    const oauth = google.oauth
    const account = google.accounts?.[USER_EMAIL] ?? {}
    const refreshToken = account.refreshToken || oauth.refreshToken
    const serviceAccount = secrets.integrations.firebase.serviceAccount
    const today = new Date().toISOString().slice(0, 10)

    if (!refreshToken) {
      throw new Error(`No refresh token found for ${USER_EMAIL}`)
    }

    const gmailToken = await exchangeRefreshToken({
      clientId: oauth.clientId,
      clientSecret: oauth.clientSecret,
      refreshToken,
    })
    const firestoreToken = await createServiceAccountAccessToken(serviceAccount)

    const profilesUrl = `${FIRESTORE_BASE}/projects/${oauth.projectId}/databases/(default)/documents/userProfiles?pageSize=1000`
    const profilesResponse = await fetch(profilesUrl, {
      headers: { Authorization: `Bearer ${firestoreToken.access_token}` },
    })

    if (!profilesResponse.ok) {
      throw new Error(`Firestore userProfiles fetch failed (${profilesResponse.status}): ${await profilesResponse.text()}`)
    }

    const profilesPayload = await profilesResponse.json()
    const documents = profilesPayload.documents ?? []
    const matchingDocs = documents.filter((doc) => {
      const fields = firestoreDocumentToObject(doc)
      return (fields.email ?? '').trim().toLowerCase() === USER_EMAIL.toLowerCase()
    })

    const sentItems = []
    for (const profileDoc of matchingDocs) {
      const uid = profileDoc.name.split('/').pop()
      const document = await fetchGoalState(oauth.projectId, uid, firestoreToken.access_token)
      if (!document) continue
      const appState = firestoreDocumentToObject(document)
      const state = appState.state ?? {}
      const dueGoals = collectDueGoals(state, today)
      for (const goal of dueGoals) {
        const { html, text } = buildGoalReminderEmail(goal)
        const raw = buildRawEmail({
          from: SENDER_EMAIL,
          to: USER_EMAIL,
          subject: `Rappel objectif — ${goal.title || 'Suivi Personnel'}`,
          html,
          text,
        })
        const result = await sendEmail(gmailToken.access_token, raw)
        sentItems.push({ uid, goalId: goal.id, title: goal.title, gmailId: result.id })
      }
    }

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: true, sent: sentItems.length, items: sentItems, today }),
    }
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    }
  }
}
