import { initializeApp } from 'firebase/app'
import { GoogleAuthProvider, getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: 'AIzaSyD2qFbsiTYj4kEY3TZ2wjEFgSTe_yngasw',
  authDomain: 'sacred-result-490618-r4.firebaseapp.com',
  projectId: 'sacred-result-490618-r4',
  storageBucket: 'sacred-result-490618-r4.firebasestorage.app',
  messagingSenderId: '323025971503',
  appId: '1:323025971503:web:6ab3794f8363b753cc59da',
}

export const ADMIN_EMAIL = 'como.denizot@gmail.com'

export const firebaseApp = initializeApp(firebaseConfig)
export const firebaseAuth = getAuth(firebaseApp)
export const firebaseDb = getFirestore(firebaseApp)
export const googleAuthProvider = new GoogleAuthProvider()
googleAuthProvider.setCustomParameters({ prompt: 'select_account' })

export function isAdminEmail(email: string | null | undefined) {
  return (email ?? '').trim().toLowerCase() === ADMIN_EMAIL
}
