# MiChacra — Preproducción

Entorno de validación de **MiChacra - Ministerio de Agro y la Producción**. Permite probar la gestión de productores, relevamientos, sincronización sin conexión, permisos e integración con WhatsApp antes de publicar cambios en la demo o en producción.

- Repositorio de preproducción: [rmgleon/michacra-preprod](https://github.com/rmgleon/michacra-preprod).
- Rama de despliegue: **`preprod`**.
- Repositorio de origen: [tiago47533548/agrooo](https://github.com/tiago47533548/agrooo).

La rama y el repositorio separados no aíslan los datos por sí solos. Preproducción debe usar un Worker, una URL y un proyecto de Firebase propios, con usuarios y datos de prueba.

## Componentes

| Componente | Implementación | Despliegue |
| --- | --- | --- |
| Aplicación web y PWA | React, TypeScript y Vite; genera `dist/` | Worker de Cloudflare con archivos estáticos |
| Datos, cuentas y fotos | Firebase Authentication, Firestore y Storage | Proyecto de Firebase de preproducción |
| Operaciones administrativas | Cloud Functions en `functions/` | Firebase, mediante un despliegue separado |
| WhatsApp y verificación de productores | API Express en `server/` | Servidor Node.js accesible por HTTPS |

**Estado de la configuración:** el repositorio todavía no incluye un archivo de Wrangler ni un adaptador de la API Express para Workers. Publicar solamente `dist/` no habilita los webhooks de WhatsApp ni las rutas de verificación de productores. Si el frontend se sirve desde Cloudflare, se debe configurar un proxy de `/api/*` hacia el servidor Node.js, conservando el mismo origen para el navegador.

## Desarrollo local

Requisitos: Node.js 22 o superior y Bun para instalar las dependencias con `bun.lock`. Las pruebas de emuladores también requieren Java 21 o superior. El runtime de Cloud Functions está configurado por separado como Node.js 20 en `firebase.json`.

Desde la raíz del repositorio:

```sh
bun install --frozen-lockfile
npm --prefix functions ci
cp .env.example .env.local
```

Completar `.env.local` con la configuración del proyecto Firebase de preproducción y ejecutar:

```sh
npm run dev
```

La web queda disponible en `http://localhost:3000`. Para probar la API, copiar también `.env.example` a `.env`, completar las variables del servidor y ejecutar en otra terminal:

```sh
npm run dev:api
```

Vite redirige `/api` al puerto `3001` durante el desarrollo. Ese proxy no se incluye en `dist/`.

## Firebase de preproducción

Crear un proyecto independiente y registrar una aplicación web. Obtener su configuración desde **Configuración del proyecto → General → Tus apps**. Habilitar los proveedores de Authentication que se utilizarán, agregar el dominio de preproducción a los dominios autorizados y crear Firestore y Storage.

Configurar estos valores en `.env.local` para desarrollo y en las variables de compilación de Cloudflare para el despliegue:

| Variable | Valor de preproducción |
| --- | --- |
| `VITE_FIREBASE_PROJECT_ID` | ID del proyecto |
| `VITE_FIREBASE_API_KEY` | `apiKey` de la aplicación web |
| `VITE_FIREBASE_APP_ID` | `appId` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `storageBucket` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId` |
| `VITE_FIRESTORE_DATABASE_ID` | ID exacto de la base de Firestore |

Si corresponden a la configuración del proyecto, completar también `VITE_FIREBASE_MEASUREMENT_ID`, `VITE_FIREBASE_OAUTH_CLIENT_ID` y `VITE_FIREBASE_RECAPTCHA_SITE_KEY`.

Mantener estas opciones desactivadas en el despliegue:

```dotenv
VITE_USE_FIREBASE_EMULATORS=false
VITE_LOAD_DEMO_DATA=false
VITE_ENABLE_PWA_DEV=false
```

Los valores `VITE_*` se incorporan al JavaScript público durante la compilación. No colocar allí claves privadas, credenciales de servicio ni tokens de WhatsApp. Si faltan variables de Firebase, el código puede usar los valores de `firebase-applet-config.json`; verificar todos los destinos antes de compilar para evitar conectarse al proyecto equivocado.

### Reglas, Functions y cuentas

`firebase.json` apunta actualmente a la base con nombre:

```text
ai-studio-sipmisionessiste-84140521-dd09-4717-8340-b1ed25aa1dd7
```

Crear una base con ese ID en el proyecto de preproducción o ajustar la configuración de despliegue si se elige otro. El frontend, la API, Functions y las reglas deben apuntar al mismo proyecto y a la misma base; publicar reglas en `(default)` no protege una base con otro nombre.

Crear `functions/.env.<ID_PROYECTO_PREPROD>` con:

```dotenv
FIRESTORE_DATABASE_ID=ai-studio-sipmisionessiste-84140521-dd09-4717-8340-b1ed25aa1dd7
FUNCTIONS_STORAGE_BUCKET=<BUCKET_PREPROD>
```

Con la CLI de Firebase autenticada y el destino revisado, compilar y desplegar explícitamente al proyecto de preproducción, reemplazando el marcador:

```sh
npm run check:functions
npx firebase deploy --only firestore,storage,functions --project <ID_PROYECTO_PREPROD>
```

Este despliegue es independiente del Worker. Los usuarios necesitan una identidad real en Firebase Auth y un perfil autorizado en `users/{uid}`. Para crear el primer administrador, configurar las credenciales y el destino de la API en `.env`, iniciar sesión con Google para crear la identidad y ejecutar:

```sh
npm run staff:provision -- --email admin@example.com --role ADMINISTRADOR
npm run staff:provision -- --email admin@example.com --role ADMINISTRADOR --apply
```

El primer comando muestra una vista previa; el segundo guarda el perfil. Volver a iniciar sesión para cargar los permisos. Los perfiles locales de demostración no otorgan acceso al servidor.

Las instrucciones de exportación, migración de municipios y revisión de datos existentes están en [Operaciones de Firebase](docs/FIREBASE_OPERATIONS.md). Si se importan registros anteriores, revisar la migración de `municipalityId` antes de habilitar consultas limitadas por municipio.

## Cloudflare Workers

Crear un Worker exclusivo para preproducción y conectarlo a `rmgleon/michacra-preprod`.

| Ajuste | Valor |
| --- | --- |
| Rama de producción del Worker | `preprod` |
| Directorio raíz | Raíz del repositorio, donde está `package.json` |
| Comando de compilación | `npm run build` |
| Archivos generados | `dist/` |
| Versión de Node para compilar | 22 o superior |

En este Worker, “rama de producción” significa la rama que publica su URL de preproducción. Se selecciona en **Settings → Build → Branch control**; los nuevos pushes a esa rama disparan la compilación y el despliegue. Ver [control de ramas de Cloudflare](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/).

Agregar las variables `VITE_*` en **Settings → Build → Variables and secrets** antes de compilar. Cambiarlas requiere una nueva compilación. Las variables de **Settings → Variables & Secrets** pertenecen al runtime del Worker y no sustituyen las variables de compilación de Vite. Ver [configuración de Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).

Para publicar el frontend como aplicación de una sola página, se puede agregar un `wrangler.jsonc` como este, ajustando `name` al nombre real del Worker:

```jsonc
{
  "name": "michacra-preprod",
  "compatibility_date": "2026-11-20",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  }
}
```

Con esa configuración, el comando de despliegue es `npx wrangler deploy`. Este ejemplo sirve el frontend; el proxy de `/api/*` requiere configuración e implementación adicionales. Ver [aplicaciones SPA en Workers](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/).

## API e integración con WhatsApp

La API necesita credenciales de Firebase Admin mediante Application Default Credentials o `GOOGLE_APPLICATION_CREDENTIALS`, además de `GCLOUD_PROJECT` y `FIRESTORE_DATABASE_ID` del entorno de preproducción. Guardar las credenciales fuera del repositorio.

Configurar en el servidor estas variables:

```dotenv
WHATSAPP_APP_SECRET=<SECRETO_APP_META>
WHATSAPP_VERIFY_TOKEN=<TOKEN_ELEGIDO_PARA_VALIDAR_EL_WEBHOOK>
WHATSAPP_ACCESS_TOKEN=<TOKEN_META>
WHATSAPP_PHONE_NUMBER_ID=<ID_DEL_NUMERO>
WHATSAPP_GRAPH_VERSION=<VERSION_COMPATIBLE_CON_LA_APP_META>
```

Usar un número de prueba o uno dedicado a preproducción. El nombre del bot es **MiChacra - Ministerio de Agro y la Producción** y también debe configurarse en el perfil comercial de Meta.

Para iniciar el servidor Node.js después de compilar el frontend:

```sh
npm run build
npm start
```

Publicarlo detrás de HTTPS y configurar en Meta el webhook `https://<DOMINIO_PREPROD>/api/whatsapp/webhook`, con el mismo token de verificación y la suscripción a `messages`. Si se usa el Worker para el frontend, esa ruta debe llegar a la API mediante el proxy.

`VITE_WHATSAPP_NUMBER` es opcional: habilita el enlace de registro en la portada y contiene el número público con código de país, solo dígitos. No es el ID de número de Meta.

Ver [documentación de WhatsApp](docs/whatsapp.md) para los flujos de registro, verificación y migración.

## Validación antes de promover cambios

Para ejecutar las verificaciones automatizadas, instalar Chromium una vez y lanzar la suite:

```sh
npx playwright install chromium
npm run test:all
```

La suite incluye pruebas unitarias, emuladores, comprobaciones de TypeScript, compilaciones y pruebas de navegador. Los emuladores usan proyectos `demo-*` aislados. Para comprobaciones individuales, consultar los scripts de `package.json`.

Además, comprobar en el entorno desplegado:

- Proyecto, base y bucket correctos en todos los componentes; sin conexiones a la demo.
- Reglas activas de Firestore y Storage coincidentes con las del repositorio. Probar con el SDK cliente o una petición sin autenticar: Firebase Console y Admin SDK omiten las reglas y no sirven para comprobar su cumplimiento.
- Lecturas y escrituras anónimas denegadas en productores, usuarios y auditoría; permisos por rol y municipio correctos.
- Inicio y cierre de sesión, invitaciones, aprobación de técnicos y rechazo de cuentas no autorizadas.
- Trabajo sin conexión, recuperación de conexión, conflictos entre dispositivos y cambio de cuenta sin mezcla de datos.
- Carga de fotos, reintentos y conservación de imágenes anteriores.
- Registro por WhatsApp y verificación posterior mediante la API, cuando esa integración esté configurada.
- Recarga de rutas y actualización de la PWA después de un despliegue.

Las pruebas locales no demuestran que las reglas publicadas estén actualizadas. El seguimiento de hallazgos y verificaciones pendientes está en [agents/ISSUES.md](agents/ISSUES.md).

## Mantener la rama de preproducción

En este checkout, `origin` apunta al repositorio original. Para enviar cambios al fork, agregar un remoto adicional si todavía no existe:

```sh
git remote add preprod-fork https://github.com/rmgleon/michacra-preprod.git
```

Para incorporar los cambios de `main` del repositorio original:

```sh
git fetch origin
git switch preprod
git merge origin/main
```

Resolver los conflictos, ejecutar las verificaciones y publicar en el fork:

```sh
git push preprod-fork preprod
```

La opción **Sync fork** sobre `main` no actualiza automáticamente `preprod`. Los cambios validados deben promoverse al repositorio original mediante el flujo de revisión acordado por el equipo; desplegar preproducción no publica la demo.
