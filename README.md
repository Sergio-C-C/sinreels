# SinReels

App personal de iOS: Instagram y YouTube en un WKWebView, sin Reels, sin Explore y sin Shorts.
DMs, perfiles, búsqueda y vídeos largos se conservan. Sin analytics ni backend: nada sale del teléfono.

No está en el App Store ni se distribuye. Se compila en GitHub Actions (no hace falta Mac) y se
instala con SideStore usando un Apple ID gratis.

> Estado: Fase 1. El código compila "en teoría": **todavía no se ha compilado ni probado en un iPhone**.
> Lo verificado y lo no verificado está al final.

## Cómo funciona

Tres capas, todas leyendo el mismo archivo [`Resources/rules.json`](Resources/rules.json):

| Capa | Dónde | Qué cubre |
|---|---|---|
| 1. URL | `WKNavigationDelegate` ([App/WebSession.swift](App/WebSession.swift)) | Cargas completas y redirecciones: `/reels/`, `/explore/`, `/shorts/ID` → `/watch?v=ID` |
| 2. CSS | `<style>` inyectado en `documentStart` ([Resources/page.js](Resources/page.js)) | Oculta pestañas, shelves y enlaces por `href` / etiqueta |
| 3. JS | `MutationObserver` + sondeo de `location.href` + guardia de clics | Navegación SPA (`pushState`), contenido que llega con el scroll, chips por texto |

La decisión "permitir / redirigir / bloquear / abrir fuera" vive en un solo sitio,
[`Resources/core.js`](Resources/core.js), que se ejecuta igual en Swift (JavaScriptCore), en la página y en los tests.

No hay ajustes ni interruptor para apagar el bloqueo. Las reglas van dentro del binario:
cambiarlas exige editar `rules.json`, esperar la compilación e instalar de nuevo.

## Requisitos

- iPhone con iOS 17 o superior y código de desbloqueo.
- PC con Windows 10/11 de 64 bits (solo para la instalación inicial de SideStore).
- Cuenta de GitHub (repo público = minutos de macOS gratis).
- Apple ID gratis. Recomendado: uno secundario, solo para firmar.
- Node 20+ en el PC si quieres correr las comprobaciones locales.

## 1. Subir el repo y compilar

Crea en github.com un repositorio **público y vacío** llamado `sinreels` (sin README). Después, en esta carpeta:

```bash
git config user.name "TU_USUARIO_GITHUB"
```

```bash
git config user.email "TU_USUARIO_GITHUB@users.noreply.github.com"
```

```bash
git remote add origin https://github.com/TU_USUARIO_GITHUB/sinreels.git
```

```bash
git push -u origin main
```

Salida esperada del push: `branch 'main' set up to track 'origin/main'`.

En GitHub → pestaña **Actions** → workflow `build`. Debe terminar en verde en unos 5–15 minutos, con dos jobs:
`Reglas (Node)` e `iOS (tests + IPA sin firmar)`. El IPA queda en el run, sección **Artifacts** → `SinReels-ipa`.

Para tener un enlace de descarga cómodo desde el iPhone, publica una versión:

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

El IPA aparece en **Releases** → `v0.1.0` → `SinReels.ipa`.

Si el job de iOS se queda en "Queued" más de 10 minutos, cambia `runs-on: xcode-27` por `runs-on: macos-26`
en [.github/workflows/build.yml](.github/workflows/build.yml).

## 2. Instalar SideStore (una sola vez)

Sigue la guía oficial, que cambia con frecuencia: <https://docs.sidestore.io/docs/installation/prerequisites>.
Resumen a noviembre de 2026:

1. En el iPhone: instala **LocalDevVPN** desde el App Store y conéctala.
2. En el iPhone: Ajustes → Privacidad y seguridad → **Modo de desarrollador** → activar (pide reiniciar).
   Si la opción no aparece, aparecerá después del primer intento de instalación.
3. En el PC: instala **iTunes** desde la web de Apple (no la versión de Microsoft Store).
4. En el PC: instala **iloader** (el `.msi`) desde la guía de SideStore.
5. Conecta el iPhone por cable, pulsa "Confiar", y en iloader inicia sesión con tu Apple ID e instala SideStore.
   La contraseña se escribe en iloader, nunca en un chat.
6. En el iPhone: Ajustes → General → VPN y gestión de dispositivos → confía en tu Apple ID.
7. Abre SideStore con LocalDevVPN conectada e inicia sesión con el mismo Apple ID.

Usa SideStore **0.7.0 o posterior**: las versiones anteriores tienen el inicio de sesión roto desde septiembre de 2026.

## 3. Instalar SinReels

1. En Safari del iPhone, abre la página de Releases de tu repo y descarga `SinReels.ipa`.
2. Conecta LocalDevVPN.
3. SideStore → **My Apps** → `+` → elige `SinReels.ipa`.
4. Borra las apps nativas de Instagram y YouTube. Sin esto, la app no sirve de nada.

## 4. Renovar cada 7 días

Con Apple ID gratis la firma caduca a los 7 días y la app deja de abrir.

- Renovación: LocalDevVPN conectada + Wi-Fi → SideStore → **My Apps** → **Refresh All**.
- Hazlo cada 5–6 días. SideStore puede renovar en segundo plano, pero no es fiable: no dependas de ello.
- Si caducó: los datos de sesión se conservan mientras no borres la app. Renueva y vuelve a abrir.
- Límites del Apple ID gratis: 3 apps instaladas por esta vía (SideStore cuenta como una) y 10 App IDs cada 7 días.

## 5. Parchear reglas cuando cambie la web

1. En el iPhone: pestaña **Diagnóstico** → "Volcar Instagram" o "Volcar YouTube" con la página problemática abierta → **Copiar todo**.
2. Edita [`Resources/rules.json`](Resources/rules.json). Prefiere `href`, `aria-label`, `role` y nombres de etiqueta a clases ofuscadas.
3. Añade un caso a [`Tests/cases.json`](Tests/cases.json) si tocaste `pathRules`.
4. Comprueba en el PC:

```bash
node tools/check.mjs
```

Salida esperada: `OK: 33 casos, 2 plataformas` (el número sube si añades casos).

```bash
npm install --no-save --no-package-lock jsdom@24.1.3
```

```bash
node tools/dom-check.mjs
```

Salida esperada: `OK: 24 comprobaciones de DOM`.

5. Commit, push, nuevo tag (`v0.1.1`, …) e instala el IPA nuevo encima desde SideStore.

Campos de cada plataforma en `rules.json`:

| Campo | Significado |
|---|---|
| `hosts` | Hosts que pueden cargarse en la vista. Cualquier otro se abre en Safari |
| `ruleHosts` | Hosts donde se aplican `pathRules` (el resto de `hosts`, p. ej. el login de Google, pasa sin filtrar) |
| `pathRules` | En orden; gana la primera que coincide. `action`: `allow`, `redirect` (va a `to`, admite `$1`) o `block` (cancela; `to` es el destino si no hay página a la que volver) |
| `hideSelectors` | CSS `display:none` |
| `hideClosest` | JS: busca `match` y oculta su ancestro `closest` |
| `hideByText` | JS: oculta elementos `selector` cuyo texto cumple la regex `text` |
| `dataStoreID` | Identifica la sesión guardada. **No lo cambies** o perderás el login |
| `userAgent` | `safari` añade el sufijo de Safari al user agent; `default` deja el de WKWebView |

## 6. Plan de pruebas en el iPhone

Haz las pruebas en orden. Al final: **Diagnóstico → Copiar todo** y pega el texto, indicando qué número falló.
El registro contiene URLs que visitaste (incluidos nombres de usuario de perfiles); revísalo antes de pegarlo.

### Instagram

| # | Paso | Resultado esperado |
|---|---|---|
| I1 | Abre la app, pestaña Instagram, inicia sesión con usuario y contraseña | Entras al feed. (El botón "Continuar con Facebook" abre Safari y no sirve: no está soportado) |
| I2 | Cierra la app desde el selector de apps y vuelve a abrirla | Sigues con la sesión iniciada |
| I3 | Mira la barra inferior | No hay icono de Reels |
| I4 | Toca la lupa | Abre la búsqueda, sin cuadrícula de Explore. Buscar un usuario funciona |
| I5 | Desliza el feed 30 segundos | No aparece ningún reel. Las fotos y carruseles sí |
| I6 | Abre DMs, envía y recibe un mensaje | Funciona |
| I7 | Abre un reel que te hayan enviado por DM | No se abre el visor de reels (te quedas en el chat o vuelves al inicio) |
| I8 | Entra a un perfil | Carga. La pestaña de reels del perfil no aparece o no hace nada |

### YouTube

| # | Paso | Resultado esperado |
|---|---|---|
| Y1 | Pestaña YouTube, sin iniciar sesión | Carga el inicio de m.youtube.com |
| Y2 | Mira la barra inferior y el inicio | No hay pestaña Shorts ni estantes de Shorts |
| Y3 | Busca cualquier cosa | Resultados sin estantes de Shorts ni chip "Shorts" |
| Y4 | Abre un vídeo largo y toca reproducir | Reproduce. (No arranca solo: el autoplay está desactivado a propósito) |
| Y5 | Gira el teléfono con un vídeo en pantalla completa | Se ve en horizontal |
| Y6 | Toca "Acceder" e inicia sesión con Google | **Incierto.** Si Google muestra "Este navegador o app puede no ser seguro", anótalo: es el fallo esperado más probable |
| Y7 | Si Y6 funcionó: cierra y reabre la app | Sigues con la sesión iniciada |

### Qué buscar en el registro

- `js listo … UA=…` → el script se inyectó. El `UA` debe terminar en `Version/27.x Mobile/15E148 Safari/604.1`.
- `nativo redirect` / `nativo bloqueo` → actuó la capa 1.
- `js block vía click` / `js redirect vía spa` → actuó la capa 3.
- `externo https://…` → algo se abrió fuera. Si pasa durante un login, ese host falta en `hosts`.
- `error de carga …` → pégalo tal cual.

## Notificaciones

WKWebView no soporta Web Push, así que esta app **no** notifica DMs. Alternativa sin servidores (sin verificar):
en Safari, abre instagram.com → Compartir → **Añadir a pantalla de inicio**, ábrela una vez, inicia sesión y acepta
las notificaciones. Úsala solo como "timbre". Ojo: esa web app no tiene ningún filtro, así que es una vía de escape.

## Límites conocidos

- Instagram y YouTube cambian su HTML sin avisar; los selectores se rompen y hay que parchearlos.
- Borrar la app o reinstalar las apps nativas anula todo. La barrera para eso es Screen Time con un código que no conozcas (Fase 3).
- Términos de servicio: es la web oficial usada a mano, sin automatización ni scraping. El user agent tipo Safari va
  contra la política de "navegadores seguros" de Google para el login; riesgo bajo, pero no nulo.

## Estado de verificación

Verificado en el PC (Windows, Node 24):

- `tools/check.mjs`: 33 casos de URL contra `core.js` y validación de `rules.json`.
- `tools/dom-check.mjs`: 24 comprobaciones de `page.js` contra un DOM simulado (jsdom).
- `project.yml` y el workflow son YAML válido.

**No verificado:**

- Que el código Swift compile (no hay compilador de Swift para iOS en Windows). Lo dirá el primer run de Actions.
- Que la etiqueta de runner `xcode-27` exista para tu cuenta.
- Que los selectores coincidan con el Instagram y YouTube reales de hoy. Salen de conocimiento previo, no de inspección en vivo.
- Login de Instagram y de Google dentro del WKWebView.
- Instalación y renovación con SideStore en iOS 27.
