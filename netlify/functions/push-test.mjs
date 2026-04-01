import webpush from 'web-push'

const VAPID_PUBLIC_KEY = '<VAPID_PUBLIC_KEY>'
const VAPID_PRIVATE_KEY = '<VAPID_PRIVATE_KEY>'

webpush.setVapidDetails('mailto:vincent.denizbraah@gmail.com', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' }
    const body = JSON.parse(event.body || '{}')
    const subscription = body.subscription
    if (!subscription?.endpoint) return { statusCode: 400, body: JSON.stringify({ ok: false, error: 'Missing subscription.' }) }

    await webpush.sendNotification(subscription, JSON.stringify({
      title: 'Suivi personnel',
      body: 'Notifications push actives. Les rappels automatiques arrivent ensuite.',
      url: 'https://suivi-personnel-app.netlify.app',
    }))

    return { statusCode: 200, body: JSON.stringify({ ok: true }) }
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Push test failed.' }) }
  }
}
