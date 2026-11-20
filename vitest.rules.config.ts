import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Local staging/production overrides must never redirect emulator clients.
    env: {
      VITE_FIREBASE_PROJECT_ID: 'demo-sip-misiones-tests',
      VITE_FIREBASE_API_KEY: 'demo-key',
      VITE_FIREBASE_APP_ID: 'demo-app',
      VITE_FIREBASE_AUTH_DOMAIN: 'demo-sip-misiones-tests.firebaseapp.com',
      VITE_FIREBASE_STORAGE_BUCKET: 'demo-sip-misiones-tests.appspot.com',
      VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789',
      VITE_FIRESTORE_DATABASE_ID: 'ai-studio-sipmisionessiste-84140521-dd09-4717-8340-b1ed25aa1dd7',
      VITE_USE_FIREBASE_EMULATORS: 'true'
    },
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/rules/**/*.test.ts', 'tests/emulator/**/*.test.ts'],
    exclude: ['tests/emulator/workflows.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000
  }
});
