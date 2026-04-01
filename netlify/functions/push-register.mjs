import { createSign } from 'node:crypto'

const FIREBASE_AUTH_LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore'

function base64UrlEncode(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function loadSecrets() {
  const raw = process.env.OPENCLAW_SECRETS_JSON
  if (!raw) throw new Error('Missing OPENCLAW_SECRETS_JSON')
  return JSON.parse(raw)
}

async function verifyFirebaseUser(idToken, apiKey) {
  const response = await fetch(`${FIREBASE_AUTH_LOOKUP_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  })
  if (!response.ok) throw new Error(`Firebase auth lookup failed (${response.status}): ${await response.text()}`)
  const payload = await response.json()
  const user = payload.users?.[0]
  if (!user?.localId) throw new Error('Authenticated user not found.')
  return { uid: user.localId, email: user.email ?? '' }
}

async function createServiceAccountAccessToken(serviceAccount, scopes) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claim = base64UrlEncode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: scopes.join(' '),
    aud: GOOGLE_OAUTH_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  }))
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${claim}`)
  signer.end()
  const signature = signer.sign(serviceAccount.private_key)
  const jwt = `${header}.${claim}.${base64UrlEncode(signature)}`
  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!response.ok) throw new Error(`OAuth token exchange failed (${response.status}): ${await response.text()}`)
  return response.json()
}

async function firestorePatchDocument(projectId, path, accessToken, fields) {
  const updateMask = Object.keys(fields).map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&')
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}?${updateMask}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  })
  if (!response.ok) throw new Error(`Firestore patch failed (${response.status}): ${await response.text()}`)
  return response.json()
}

function firestoreMap(value) {
  return { mapValue: { fields: value } }
}
function firestoreString(value) {
  return { stringValue: value }
}
function firestoreBool(value) {
  return { booleanValue: value }
}

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
    const authHeader = event.headers.authorization || event.headers.Authorization
    const idToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : ''
    if (!idToken) return { statusCode: 401, body: JSON.stringify({ ok: false, error: 'Missing bearer token.' }) }

    const body = JSON.parse(event.body || '{}')
    const subscription = body.subscription
    const settings = body.settings
    if (!subscription?.endpoint || !settings) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing subscription payload.' }) }

    const secrets = await loadSecrets()
    const apiKey = 'AIzaSyD2qFbsiTYj4kEY3TZ2wjEFgSTe_yngasw'
    const serviceAccount = secrets.integrations?.firebase?.serviceAccount
    const projectId = serviceAccount?.project_id || 'sacred-result-490618-r4'
    if (!serviceAccount) throw new Error('Missing Firebase service account.')

    const authUser = await verifyFirebaseUser(idToken, apiKey)
    const serviceToken = await createServiceAccountAccessToken(serviceAccount, [FIRESTORE_SCOPE])
    const subscriptionId = Buffer.from(subscription.endpoint).toString('base64url').slice(-96)

    await firestorePatchDocument(projectId, `userProfiles/${authUser.uid}`, serviceToken.access_token, {
      email: firestoreString(authUser.email),
      notificationSettings: firestoreMap({
        enabled: firestoreBool(Boolean(settings.enabled)),
        dailyReminderEnabled: firestoreBool(Boolean(settings.dailyReminderEnabled)),
        dailyReminderTime: firestoreString(String(settings.dailyReminderTime || '07:00')),
        timezone: firestoreString(String(settings.timezone || 'UTC')),
        quietDaysAfterTracking: { integerValue: String(Math.max(0, Number(settings.quietDaysAfterTracking || 1))) },
        inactiveReminderEnabled: firestoreBool(Boolean(settings.inactiveReminderEnabled)),
        inactiveDaysThreshold: { integerValue: String(Math.max(1, Number(settings.inactiveDaysThreshold || 3))) },
      }),
    })

    await firestorePatchDocument(projectId, `userProfiles/${authUser.uid}/pushSubscriptions/${subscriptionId}`, serviceToken.access_token, {
      endpoint: firestoreString(subscription.endpoint),
      keys: firestoreMap({
        p256dh: firestoreString(subscription.keys?.p256dh || ''),
        auth: firestoreString(subscription.keys?.auth || ''),
      }),
      enabled: firestoreBool(true),
      userAgent: firestoreString(String(body.userAgent || '')),
    })

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Push registration failed.' }) }
  }
}
