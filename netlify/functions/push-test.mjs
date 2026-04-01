import webpush from 'web-push'

const VAPID_PUBLIC_KEY = 'BNIkJ33gbrd07BT_f_MBE6QAaXkvc2HKi5oZ8MxfkUSzfOuZ8AfTj0YA_kJI8WEtVuEFAeRJGtNAyaQHtbfRAus'
const VAPID_PRIVATE_KEY = 'ZWwOV2zBa4JnjWfO5zC2VVt797a_8gL7_h7FI8z3xxM'

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
