# WhatsApp producer registration

The server uses the WhatsApp Cloud API and the same named Firestore database as the application. It runs separately from Vite in development and serves both the API and the built frontend in production.

## Registration and verification

- Producers send `Hola` to see the introduction, then `REGISTRAR` to start. The bot collects DNI, name, municipality, establishment, colony/paraje, producer type, whether they are responsible, hectares, activities, land tenure, and an optional native WhatsApp location. It shows a summary and requires `CONFIRMAR` before creating a producer.
- Self registrations have `verificationStatus: unverified`, `verifiedBySupervisor: false`, and `registrationSource: whatsapp`. The sender number supplies the phone; producers cannot submit verification fields. `ESTADO` reports only the record linked to the requesting number.
- New records uploaded by administrators start verified. New technician surveys start unverified. Updating an existing producer preserves its verification and provenance; use the verification control to change its status.
- Approved, active technicians can verify producers in their assigned municipalities. Approved administrators and superadmins can verify any producer. Each change stores the reviewer and date and writes an audit entry atomically. Directors and supervisors cannot change producer verification.
- Both dashboards show verification badges and the record detail includes verification controls. The administrator list can filter and export verification status and origin. Verification requires an online, authenticated session and a synchronized record; it is confirmed by the server before being shown as saved.
- Old records still display their `verifiedBySupervisor` value until migrated. Editing a verified record does not reset verification.
- Self registrations identify the producer as the submitter. Reviewing or verifying a record does not assign its reviewer as the registering technician. The map's technician list and technician survey counts exclude self registrations; their CSV technician field is blank.

## Local examples

Three fictional, unverified WhatsApp producers are seeded locally: Ana Gómez, Luis Pereira and Marta Duarte (all marked `Ejemplo`). Refresh the app, then open **Admin → Productores → Sin verificar**. Ana and Luis have sample locations; Marta omitted her location. These records have `isDemo: true` and are never uploaded to Firebase, including after edits or verification. Approved demo admin/technician sessions can try verification locally; the detail marks the result as a local example. Real producers continue to require authenticated server verification.

## Local setup

Use Node 22+ and Java 21+ for emulator tests. Install dependencies with `bun install --frozen-lockfile`. Copy `.env.example` to `.env` and configure the five `WHATSAPP_*` server variables. `WHATSAPP_GRAPH_VERSION` must be a supported Graph version for your Meta app. `VITE_WHATSAPP_NUMBER` is the public business number, including country code, and enables the landing page registration link. It is different from `WHATSAPP_PHONE_NUMBER_ID`.

The server reads `GCLOUD_PROJECT` and `FIRESTORE_DATABASE_ID`, falling back to `firebase-applet-config.json`. Provide Application Default Credentials or `GOOGLE_APPLICATION_CREDENTIALS` pointing to a service account file outside this repository. Never put server secrets in `VITE_*` variables.

Run in two terminals:

```sh
npm run dev:api
npm run dev
```

Vite proxies `/api` to port 3001. If you change the API port, change the proxy in `vite.config.ts` too. The callback URL is `https://YOUR_PUBLIC_HTTPS_HOST/api/whatsapp/webhook`; use an HTTPS tunnel to the Vite port for local Meta testing.

In the Meta app, configure the callback URL and the matching verify token, subscribe to the `messages` webhook field, and connect the business phone number. The webhook checks Meta's GET challenge and validates every POST using HMAC-SHA256 over the raw request body. These follow [Meta's webhook verification protocol](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/); this implementation uses HTTP directly, without the archived SDK.

## Staff accounts and existing data

Staff must have a real, enabled Firebase Auth account with a verified email and a server-side `users/{firebaseUid}` profile. Browser-local demo accounts and the hardcoded email list do not grant server access. Sign in with Google once to create the Auth identity; then provision the account from a trusted environment:

```sh
npm run staff:provision -- --email admin@example.com --role ADMINISTRADOR
npm run staff:provision -- --email admin@example.com --role ADMINISTRADOR --apply
npm run staff:provision -- --email technician@example.com --role TECNICO --municipalities obera,campo_viera --apply
```

The first command previews the change. Provisioned users should sign in with Google again. Google login loads the server profile, including its role and assignments. Existing local technician approval/invitation screens do not provision server accounts; use this script for cloud access.

Before enabling the bot against an existing database, normalize older DNIs so duplicate checks also catch formatted values such as `30.123.456`. The migration preserves existing verification and advances cloud revisions so stale edits cannot overwrite it:

```sh
npm run producers:migrate-verification
npm run producers:migrate-verification -- --apply
```

Run migration during a maintenance window and synchronize staff devices afterward. It does not infer who verified old records or change unverified records to verified.

## Deployment

Build with `npm run build`, then run `npm start` with Node 22+, dependencies including `tsx`, application credentials and the server environment variables. Put the server behind HTTPS. A deployment serving only `dist/` cannot receive WhatsApp webhooks or save verification. If the frontend is hosted elsewhere, proxy `/api` to this server on the same origin.

Provision staff profiles before deploying the rules: the previous rules allowed unauthenticated writes, while the new rules require approved server accounts and deny client writes to roles, verification, audits, WhatsApp sessions and events. Deploy `firestore.rules` to the named database in `firebase.json`, adjusting that database if your environment differs:

```sh
npx firebase deploy --only firestore:rules --project YOUR_FIREBASE_PROJECT
```

The server and client must use that same project and database. Existing local-only accounts can continue offline work, but cannot synchronize until provisioned and authenticated with Firebase.

Enable Firestore TTL on `expiresAt` in the `whatsappSessions` and `whatsappEvents` collection groups. Drafts expire after 24 hours; delivery event documents expire after seven days. Expired drafts are ignored even before TTL deletes them. Only confirmed registrations are copied to `producers`; those records and audit history are retained separately.

Message IDs, session changes and producer creation commit in a single Firestore transaction. DNI reservations prevent simultaneous WhatsApp submissions from creating duplicates. Each delivery has a lease, and a failed send returns HTTP 503 so Meta can retry the stored reply without advancing the conversation again. A crash after Meta accepts a reply but before the delivery marker is stored can repeat the reply; it cannot duplicate the producer. Messages older than 24 hours are ignored. This first version supports one producer registration per sender number; shared phones and updates to existing registrations go through a technician.

The bot currently offers municipalities in `src/db/misionesCatalog.ts` (24 entries). Extend that catalog and the municipality mapping in `firestore.rules` before offering registration in additional municipalities. It accepts text and native location messages; audio, photos and other messages prompt the producer to answer the current question in the supported format.

## Validation

```sh
npm test
npm run test:emulator
npm run lint
npm run build
```

Emulator tests use `demo-sip-whatsapp`, not the production project, and mock outbound WhatsApp requests. They cover concurrent message retries, duplicate DNI registration, persisted delivery retries, status privacy, reviewer permissions and municipality assignments, revision conflicts, the HTTP endpoints, and security rules. A real Meta round trip still requires the configured business number and credentials.
