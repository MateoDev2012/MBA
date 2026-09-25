<div align="center">

# Roblox Stats API

**Estadísticas en vivo de juegos de Roblox en una API REST simple.**

Dueño · likes · jugadores activos · visitas · logo · banners · game passes · badges

[English / English version](README.md) · Sin API key · CORS abierto

</div>

---

Una API REST pública y gratuita que devuelve **datos reales y en vivo de Roblox** sobre cualquier juego. Dale un `universeId` y obtén en una sola petición el dueño, los likes, los jugadores conectados, las visitas, el logo, los banners y más.

Pensada para quien quiera hacer una tabla de clasificación de juegos, una página de estadísticas o una tarjeta de juego en su web sin tener que pelearte con los endpoints de Roblox por su cuenta.

Y si solo quieres pintar un número en una página, no hace falta escribir nada de JavaScript. **Un archivo, una etiqueta, listo:**

```html
<p>{{playing}} jugadores ahora</p>
<script src="https://tu-dominio.com/roblox-stats.js"></script>
```

```bash
curl https://tu-dominio.com/api/v1/games/994732206
```

```json
{
  "ok": true,
  "data": {
    "id": 994732206,
    "name": "Blox Fruits",
    "playing": 247363,
    "visits": 64655032396,
    "creator": { "name": "Gamer Robot Inc", "type": "Group" },
    "ratings": { "upVotes": 12709795, "favorites": 19978649, "upVoteRatio": 92.3 },
    "thumbnail": "https://tr.rbxcdn.com/.../512/512/Image/Png/noFilter",
    "images": ["https://tr.rbxcdn.com/.../768/432/Image/Png/noFilter"]
  }
}
```

## Por qué existe esto

La API pública de Roblox funciona bien, pero está repartida en cinco dominios distintos, los paths son inconsistentes, algunos están mal documentados y las respuestas hay que parsearlas antes de que sirvan de algo. Esto envuelve todo eso en un formato único y predecible.

Algunos detalles de la API de Roblox que te van a estropear el día si la consultas directamente:

| Trampa | Realidad |
| --- | --- |
| `/v1/games/favorites/count?universeIds=` | Devuelve 404. El path que funciona es `/v1/games/{id}/favorites/count`, en singular y de un id en uno. |
| `thumbnails/multiget/thumbnails?universeIds=` sin `size` | Devuelve 400. `size` es obligatorio. |
| `games/{id}/game-passes` | Devuelve 404. El endpoint vivo está en `apis.roblox.com/game-passes/v1/...`. |
| `badges/{id}/badges?limit=5` | Devuelve 400. `limit` tiene que ser un número **par**. |
| `games/{id}/servers/Public` | Se retiró de la API pública; necesita una clave de developer. Aquí no está. |
| Precios de los game passes | No vienen en el listado. Requieren una llamada extra por pass, así que son opcionales. |
| `placeId` vs `universeId` | Son ids distintos. Una URL terminada en `/Place` lleva un placeId. |
| `v2/groups/{id}/games` | Solo acepta páginas de 10, 25, 50 o 100. Cualquier otro valor es un 400. |
| `v2/groups/{id}/games` | No devuelve ningún contador de jugadores, y llama `visits` como `placeVisits`. |
| Resultados de búsqueda | Vienen como muchos grupos de un juego, no como un grupo con una lista. |

## Características

- **Escribe el nombre de la stat y obtén el número** — pon `{{playing}}` en tu HTML y se rellena solo. Sin frameworks, sin build.
- **Todo en una llamada** — datos del juego, dueño, votos, favoritos, logo, banners y media en una sola respuesta.
- **Sin API key y CORS abierto** — pega la URL en un `<script>` o en un `fetch()` y funciona.
- **Widget** — un solo `<script>` pinta una tarjeta con los datos en vivo, estilable con CSS.
- **Plantillas en el servidor** — `POST /api/v1/render` devuelve tu HTML con los números ya puestos.
- **SDK para Node** — cliente sin dependencias para código de servidor.
- **Servidor MCP** — permite que agentes de IA consulten estadísticas de Roblox como herramienta.
- **Descubrimiento** — juegos en tendencia, juegos por creador y una lista legible por máquina de todas las variables válidas.
- **Endpoint por lotes** — hasta 50 juegos en una petición en vez de 50 peticiones.
- **Caché integrada** — ajustada por tipo de dato para no pasarse de los límites de Roblox.
- **Rate limiting** — por IP, para que un script no agote la cuota.
- **Resiliencia frente a Roblox** — timeouts, reintentos con backoff y cancelación de peticiones.

## Endpoints

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/api/v1/games/{universeId}` | Datos completos: dueño, votos, favoritos, logo, banners, media |
| `GET` | `/api/v1/games/{universeId}/quick` | Versión ligera sin media pesada. Ideal para tarjetas y listados |
| `GET` | `/api/v1/games/batch?ids=1,2,3` | Hasta 50 juegos en una llamada |
| `GET` | `/api/v1/resolve?url={url}` | Convierte cualquier URL de Roblox a `universeId` |
| `GET` | `/api/v1/search?q={texto}&limit=10` | Busca juegos por nombre |
| `GET` | `/api/v1/trending?limit=20[&includeMedia=true]` | Los juegos más jugados ahora, ordenados por jugadores en vivo. `includeMedia` añade miniaturas y banners |
| `GET` | `/api/v1/groups/{groupId}/games?limit=50` | Juegos publicados por un grupo (`&includeStats=true` añade los jugadores) |
| `GET` | `/api/v1/users/{userId}/games?limit=50` | Juegos publicados por un usuario, mismas opciones |
| `GET` | `/api/v1/games/{universeId}/game-passes` | Game passes (`?includePrices=true` para los precios) |
| `GET` | `/api/v1/games/{universeId}/badges` | Badges del juego |
| `GET` | `/api/v1/games/{universeId}/developer` | Datos del creador, más el grupo si el dueño es un grupo |
| `GET` | `/api/v1/groups/{groupId}` | Nombre, descripción y miembros de un grupo |
| `GET` | `/api/v1/fields` | Todos los nombres de variable válidos, legible por máquina |
| `POST` | `/api/v1/render` | Rellena `{{placeholders}}` en un HTML con datos en vivo |
| `POST` | `/api/v1/render/multi` | Igual, para varios juegos: `{{universeId:campo}}` |
| `GET` | `/api` | Índice JSON con todos los endpoints |
| `GET` | `/health` | Estado del servicio y de la caché |

Todas las respuestas usan el mismo envoltorio:

```json
{ "ok": true, "data": { } }
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```

## Empezar

```bash
git clone https://github.com/tu-usuario/roblox-stats-api.git
cd roblox-stats-api
npm install
npm start
```

```bash
curl http://localhost:3000/api/v1/games/994732206
```

Abre <http://localhost:3000> para la página de documentación con un playground en vivo.

Scripts:

| Comando | Qué hace |
| --- | --- |
| `npm start` | Arranca el servidor |
| `npm run dev` | Arranca recargando solo al cambiar los archivos |
| `npm test` | Ejecuta todas las suites (el servidor debe estar ya arrancado, salvo la de auth) |
| `npm run smoke` | Prueba todos los endpoints contra el servidor local |
| `npm run smoke:auth` | Prueba la capa de API keys. Arranca y para sus propios servidores |
| `npm run mcp` | Arranca el servidor MCP para agentes de IA |

Si tu servidor tiene keys configuradas, define `API_KEY` en el entorno antes de `npm test`, o la suite de
endpoints devolverá 401 contra un despliegue correctamente configurado y parecerá que la API está rota.

## Uso

### Escribe el nombre de la stat y obtén el número

`roblox-stats.js` es el único archivo que necesitas para usar esta API. Es un JavaScript normal, sin dependencias, sin build y sin framework. Lo copias a tu proyecto, añades la etiqueta y escribes los nombres de las stats.

> **El aviso de créditos es obligatorio.** El archivo añade una pegatina pequeña "MBA · Made by Moonlight Studios" en la parte de abajo de la página, con "Moonlight Studios" enlazado al sitio del estudio. Si la borras o la escondes con CSS, el archivo deja de cargar datos, te lo dice en la página y te ofrece un botón **Restore the credit**. Eso es lo que mantiene esta API gratuita. Puedes cambiar el aspecto de la pegatina con `#rbxw-credit` y el texto o el enlace en el objeto `CREDIT`, cerca del principio del archivo.

> **Dos ajustes, cerca del principio del archivo.** `SITE_URL` es adonde enlaza la pegatina (viene vacío, así
> que se muestra como texto plano en vez de apuntar a un dominio que puede que no sea el tuyo) y `API_KEY`
> se manda como cabecera `X-API-Key` en cada llamada. No tienes que tocar ninguno de los dos; ponle
> `SITE_URL` para que la pegatina sea un enlace de verdad.

```html
<body data-rbx-game="994732206">

  <h2>{{name}}</h2>
  <p>{{playing}} jugadores ahora &middot; {{likes}} likes</p>
  <img data-rbx-set="src=thumbnail:url" alt="">

  <script src="https://tu-dominio.com/roblox-stats.js"></script>
</body>
```

Esa es toda la integración: un archivo, una etiqueta, una línea de JavaScript. Una petición por juego, por muchas variables que use la página.

| Escribes | Obtienes |
| --- | --- |
| `{{playing}}` | `245.4K`, abreviado cuando se lee mejor |
| `{{playing:raw}}` | `245412`, el número exacto |
| `{{playing:short}}` | `245.4K`, siempre abreviado |
| `{{thumbnail:url}}` | Escapado para usarlo en `src="..."` |
| `<span data-rbx-bind="playing"></span>` | Pone el valor como texto del elemento |
| `<img data-rbx-set="src=thumbnail:url">` | Pone un atributo cuando la URL ya es real |

Para imágenes prefiere `data-rbx-set` antes que `src="{{thumbnail:url}}"`. Un `src` literal hace que el navegador pida el texto del placeholder antes de que corra el script, y eso deja un 404 en la consola en cada carga.

**Varios juegos en una página.** `data-rbx-game` puede ir en cualquier elemento, y ese elemento es dueño de las variables que hay dentro. Las tarjetas anidadas conservan sus propios números.

```html
<div data-rbx-game="994732206">{{name}}: {{playing}}</div>
<div data-rbx-game="1686885941">{{name}}: {{playing}}</div>
```

**Un error de escritura se reporta, no se esconde.** Si escribes mal un nombre, la consola te dice cuál es, en vez de dejar un hueco en blanco. `GET /api/v1/fields` devuelve la lista oficial de los 20 nombres.

### Plantillas en el servidor

Si generas el HTML tú mismo, deja que el servidor haga la sustitución.

```bash
curl -X POST https://tu-dominio.com/api/v1/render \
  -H 'Content-Type: application/json' \
  -d '{"universeId":994732206,"html":"<b>{{playing}}</b> jugadores en <b>{{name}}</b>"}'
```

```json
{ "ok": true, "data": { "html": "<b>245.4K</b> jugadores en <b>Blox Fruits</b>", "used": ["playing","name"] } }
```

Para varios juegos a la vez, direcciónalos por id:

```bash
curl -X POST https://tu-dominio.com/api/v1/render/multi \
  -H 'Content-Type: application/json' \
  -d '{"universeIds":[994732206,1686885941],"html":"{{994732206:playing}} vs {{1686885941:playing:short}}"}'
```

### Navegador

```js
const res = await fetch('https://tu-dominio.com/api/v1/games/994732206');
const { data } = await res.json();

document.querySelector('#name').textContent = data.name;
document.querySelector('#players').textContent = data.playing.toLocaleString();
document.querySelector('#logo').src = data.thumbnail;
```

### Tarjeta automática

El mismo archivo, sin etiqueta extra. Pones un id en un `<div>` vacío y se convierte en una tarjeta en vivo:

```html
<div data-roblox-game="994732206"></div>
<script src="https://tu-dominio.com/roblox-stats.js"></script>
```

El `<div>` se llena con el banner, el logo, el dueño, los jugadores, los likes y las visitas. No inyecta CSS global, así que no choca con tus estilos.

| Atributo | Valores | Por defecto |
| --- | --- | --- |
| `data-roblox-game` | `universeId` | *(obligatorio)* |
| `data-roblox-theme` | `dark`, `light` | `dark` |
| `data-roblox-fields` | `stats`, `compact` | `stats` |
| `data-roblox-refresh` | Segundos entre actualizaciones, `0` para desactivar | `0` |

Todos los elementos llevan el prefijo `rbxw-`, así que puedes cambiar el diseño con CSS normal:

```css
.rbxw-card { border-radius: 20px; }
.rbxw-live { color: #00ff88; }
```

### Node.js

```bash
npm install roblox-stats-sdk
```

```js
import { getGame, search, render, trending, getGroupGames } from 'roblox-stats-sdk';

const game = await getGame(994732206);
console.log(game.name, game.playing, game.ratings.upVotes);

const results = await search('Blox Fruits', { limit: 5 });

// Las plantillas funcionan igual desde Node
const { html } = await render(994732206, '<b>{{playing}}</b> jugadores');
console.log(html); // <b>245.4K</b> jugadores

// Descubrimiento
const hot = await trending({ limit: 5 });
const owned = await getGroupGames(4372130, { includeStats: true });
```

El SDK desenvuelve la respuesta, así que los métodos devuelven los datos directamente y no `{ ok, data }`.

¿Prefieres apuntar a tu propio despliegue?

```js
import { createClient } from 'roblox-stats-sdk';

const client = createClient({ baseUrl: 'https://tu-dominio.com' });
const game = await client.getGame(994732206);
```

### Python

```python
import requests

data = requests.get("https://tu-dominio.com/api/v1/games/994732206").json()["data"]
print(data["name"], data["playing"], data["ratings"]["upVotes"])
```

### PHP

```php
$data = json_decode(file_get_contents(
    "https://tu-dominio.com/api/v1/games/994732206"
), true)["data"];
echo $data["name"] . " — " . number_format($data["playing"]) . " jugando";
```

### Agentes de IA (MCP)

```json
{
  "mcpServers": {
    "roblox-stats": {
      "command": "node",
      "args": ["/ruta/absoluta/a/roblox-stats-api/extras/mcp/server.js"],
      "env": { "ROBLOX_API_URL": "https://tu-dominio.com" }
    }
  }
}
```

Se exponen nueve herramientas:

| Herramienta | Qué hace |
| --- | --- |
| `get_roblox_game` | Estadísticas completas de un juego |
| `search_roblox_games` | Buscar por nombre |
| `resolve_roblox_url` | URL de Roblox a `universeId` |
| `get_roblox_game_passes` | Game passes, con precios opcionales |
| `get_roblox_badges` | Badges de un juego |
| `get_roblox_trending` | Los juegos más jugados ahora mismo |
| `get_roblox_creator_games` | Todos los juegos de un grupo o usuario |
| `fill_roblox_template` | Rellena `{{placeholders}}` con datos en vivo |
| `list_roblox_fields` | Los nombres de variable válidos |

Cada una es una sola ida y vuelta, así que un agente puede responder "¿cuántos jugadores hay ahora en X?" o "¿qué publica este grupo?" sin escribir código.

## Qué recibes

```json
{
  "ok": true,
  "data": {
    "id": 994732206,
    "name": "Blox Fruits",
    "description": "Welcome to Blox Fruits!",
    "url": "https://www.roblox.com/games/994732206",
    "rootPlaceId": 2753915549,
    "playing": 247363,
    "visits": 64655032396,
    "maxPlayers": 100,
    "created": "2021-07-18T18:02:47.187Z",
    "updated": "2026-08-05T00:29:32.278Z",
    "genre": "All",
    "copyingAllowed": false,
    "creator": {
      "id": 4372130,
      "name": "Gamer Robot Inc",
      "type": "Group",
      "hasVerifiedBadge": false,
      "url": "https://www.roblox.com/groups/4372130"
    },
    "ratings": {
      "upVotes": 12709795,
      "downVotes": 1062767,
      "totalVotes": 13772562,
      "upVoteRatio": 92.3,
      "favorites": 19978649
    },
    "thumbnail": "https://tr.rbxcdn.com/.../512/512/Image/Png/noFilter",
    "images": ["https://tr.rbxcdn.com/.../768/432/Image/Png/noFilter"],
    "media": [
      { "type": "Image", "imageId": 126410127976844, "videoHash": null }
    ]
  }
}
```

## Configuración

Todo tiene un valor por defecto razonable, así que puedes arrancarlo sin configurar nada. Para cambiar algo, copia `.env.example` a `.env`:

| Variable | Por defecto | Qué hace |
| --- | --- | --- |
| `PORT` | `3000` | Puerto del servidor |
| `CORS_ORIGIN` | `*` | Orígenes permitidos. `*` para público, o una lista separada por comas para restringirlo |
| `CACHE_TTL_STATS` | `30` | TTL de la caché de datos del juego y jugadores activos, en segundos |
| `CACHE_TTL_VOTES` | `300` | TTL de la caché de votos |
| `CACHE_TTL_FAVORITES` | `600` | TTL de la caché de favoritos |
| `CACHE_TTL_MEDIA` | `3600` | TTL de la caché de logos, banners y media |
| `RATE_LIMIT_MAX` | `120` | Peticiones permitidas por IP y ventana. Valor de reserva para las dos de abajo |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Ventana del rate limit, en ms |
| `API_KEYS` | *(vacío)* | Tus keys, separadas por `;`. Ver [API keys](#api-keys) |
| `API_KEY_MODE` | `optional` si hay keys, si no `off` | `off`, `optional` o `required` |
| `RATE_LIMIT_ANON_MAX` | `30` | Peticiones por minuto para quien no manda una key válida |
| `RATE_LIMIT_KEYED_MAX` | `600` | Peticiones por minuto para quien sí manda una key válida |
| `UPSTREAM_TIMEOUT_MS` | `10000` | Timeout de las peticiones a Roblox |
| `USER_AGENT` | `RobloxStatsAPI/1.0` | Identifica tu API ante Roblox |

## API keys

Opcionales, y apagadas por defecto. Si no pones `API_KEYS`, todo funciona sin key, que es lo que debería
pasar en una instalación local.

```env
API_KEYS=Made by MoonlightStudios
API_KEY_MODE=optional
```

Cada entrada es `key`, `key:Name` o `key:Name:dominio.com,www.dominio.com`, separada por `;` (punto y coma,
porque la lista de dominios ya usa comas). Un bloqueo por dominio cubre también los subdominios, y un
dominio parecido como `notejemplo.com` **no** pasa un bloqueo de `ejemplo.com`.

Tres modos:

| Modo | Sin key | Con una key válida |
| --- | --- | --- |
| `off` | Funciona | Funciona. Solo posible si `API_KEYS` está vacío |
| `optional` | Funciona, con `RATE_LIMIT_ANON_MAX` | Funciona, con `RATE_LIMIT_KEYED_MAX`, y además lleva la cuenta de peticiones |
| `required` | `401` | Funciona, con `RATE_LIMIT_KEYED_MAX` |

`optional` es el valor por defecto en cuanto existen keys, porque pasar a `required` también apaga la
documentación y la demo de este mismo proyecto si no se autenticaran. Pero sí se autentican:
`/api/v1/keys/me` está abierto y, en modo `required`, entrega la key pública para que la página de
documentación siga funcionando. Eso no filtra ningún secreto: quien quisiera la key puede descargar el
archivo `.js` público, que está ahí mismo. Ocultarlo según `Origin` tendría aspecto de protección sin
detener a nadie, y además rompería la documentación, porque una petición `GET` del mismo origen no manda
cabecera `Origin` ninguna. Con más de una key configurada no entrega nada, porque elegir una sería
arbitrario: quédate en `optional` en ese caso.

Manda la key en una cabecera, no en la URL:

```js
fetch('https://tu-dominio.com/api/v1/games/994732206', {
  headers: { 'X-API-Key': 'Made by MoonlightStudios' },
});
```

`Authorization: Bearer <key>` y `?key=<key>` también funcionan. La cabecera es la que conviene: un
parámetro en la URL acaba en los registros de acceso, en el historial del navegador y en la cabecera
`Referer` de cada enlace saliente de la página.

### Una key no es un secreto

Conviene decirlo claro, porque la otra opción es dar una falsa sensación de seguridad. Una key que se usa
desde el navegador viaja dentro de `roblox-stats.js`, que es un archivo público. Cualquiera puede leerla con
"ver código fuente".

Lo que una key sí aporta:

- Un límite de peticiones que tú controlas, por key y no solo por IP
- Revocar a un usuario concreto sin reiniciar nada
- Un bloqueo opcional por dominio
- Un contador de peticiones por key, visible en `GET /api/v1/keys/me`

Lo que no aporta: privacidad. No es lo que mantiene gratis esta API, eso es el aviso de créditos de
`roblox-stats.js`. No pongas nada confidencial detrás de una, ni trates una key filtrada como una
brecha.

### Qué queda fuera de la key

`/roblox-stats.js` y los archivos estáticos se sirven **antes** de comprobar la key, a propósito. La key
está dentro del archivo, así que la petición que lo descarga no puede llevar ninguna; protegerlo haría
inservible el modo `required`. Además, un archivo estático no gasta ni una petición a Roblox, que es lo
único que protege el rate limit.

`/health` y `/api/v1/keys/me` también están abiertos, porque cada uno es la forma que tiene quien llama de
averiguar por qué se le está rechazando, y un diagnóstico que contesta 401 es peor que no tener
diagnóstico. Ninguno de los dos devuelve nada confidencial.

Las respuestas llevan `X-RBX-Key` (`valid`, `none` o `wrong-domain`) para que una página pueda comprobar su
key sin provocar un error, y está en `Access-Control-Expose-Headers` para que otra página de otro dominio
pueda realmente leerlo.

## Cómo funciona la caché

La caché no es aquí un truco de rendimiento: es lo que mantiene viva la API. Cada valor se cachea con un TTL acorde a cada cuánto cambia de verdad:

- `playing` (jugadores activos) — **30 s**. Cambia cada segundo, pero 30 s ya es mucho más preciso que el dato que publica la propia Roblox.
- Votos — **5 min**. Se mueven poco.
- Favoritos — **10 min**.
- Logos, banners, media — **1 h**. Casi nunca cambian.

Las peticiones también se deduplican: si 50 personas piden el mismo juego en frío al mismo tiempo, Roblox recibe una llamada, no cincuenta.

## CDN y caché

Todas las respuestas llevan un header `Cache-Control` ajustado a cada endpoint, para que un CDN delante de la API (Cloudflare, Bunny, Fastly) o el propio navegador pueda responder la mayoría de las peticiones sin que tu servidor toque Roblox:

| Endpoint | `Cache-Control` |
| --- | --- |
| `/games/{id}`, `/games/{id}/quick`, `/games/batch`, `/games/{id}/developer` | `max-age=30` |
| `/search` | `max-age=300` |
| `/groups/{id}` | `max-age=600` |
| `/resolve`, `/game-passes`, `/badges` | `max-age=3600` |

`stale-while-revalidate` vale el doble del `max-age`, así el CDN sigue sirviendo datos ligeramente antiguos mientras los refresca en segundo plano, en vez de bloquear la petición.

Esto es lo más importante que debes tener en cuenta si lo despliegas públicamente: con un CDN delante, una llamada a Roblox puede servir cientos de peticiones, y tu cuota dura prácticamente para siempre.

## Desplegar

La app es un servidor Node normal sin paso de build, así que corre en cualquier parte.

**Render / Railway / Fly.io / cualquier VPS**

```bash
npm install
npm start
```

Configura `PORT` si tu hosting no la inyecta, y pon `CORS_ORIGIN` con tu dominio real cuando lo tengas.

**Detrás de nginx** — recuerda reenviar la IP del cliente, si no el rate limiter mete a todo el mundo bajo la misma dirección:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`app.set('trust proxy', 1)` ya está activado en `src/server.js`.

## Estructura del proyecto

Todo el proyecto son **tres carpetas**. Dos nunca las abres.

```
roblox-stats.js     ← EL archivo. Esto es lo que la gente copia en su web.
src/                 ← el servidor que despliegas (no se edita salvo que Roblox se rompa)
public/              ← la página web de documentación
extras/              ← opcional: SDK, MCP y tests. Ignora esta carpeta.
node_modules/        ← lo genera npm install. Nunca abrir, nunca editar.
package.json         ← las 2 dependencias y los comandos de npm
README.es.md
```

### Qué hay en cada carpeta

| Carpeta | Qué es | ¿La tocas? |
| --- | --- | --- |
| `src/` | El servidor de la API. 13 archivos pequeños, cada uno hace una cosa: hablar con Roblox, cachear, formatear. | No. Lo despliegas y te olvidas. |
| `public/` | La página de documentación que ves en `/`. | Solo si quieres cambiar los textos. |
| `extras/` | Tres cosas opcionales juntas para que no molesten en la raíz. | No. |
| `node_modules/` | Archivos que descargó `npm install`. Miles. No son tuyos. | Nunca. |

**`node_modules/` no es tu código.** Son las dos librerías que necesita el servidor
(`express` y `cors`), descargadas automáticamente. Está en `.gitignore` para que nunca
se suba a ningún lado. Ignóralo por completo.

### ¿Qué hay dentro de `extras/`?

Las tres son opcionales. Borra la carpeta y la API sigue funcionando; solo `npm test` dejaría de funcionar.

| Archivo | Qué es | Quién lo necesita |
| --- | --- | --- |
| `extras/sdk/index.js` | **SDK** = un atajo para programadores. En vez de escribir `fetch(".../api/v1/games/994732206")` y leer el JSON a mano, escribes `await getGame(994732206)`. Son 2 líneas de comodidad. | Solo si programas del lado del servidor en Node.js. |
| `extras/mcp/server.js` | **MCP** = Model Context Protocol, el estándar que permite que una IA (Claude, Cursor, Copilot...) use una herramienta. Conectado, puedes *preguntarle* a tu IA «¿cuántos jugadores hay en Blox Fruits ahora?» y consulta esta API en vivo. | Solo si quieres que una IA use la API por ti. |
| `extras/tests/smoke.js` | Los tests. 46 comprobaciones que pegan a la API real de Roblox y confirman que cada endpoint sigue respondiendo. | Solo si cambias el código. |
| `extras/tests/smoke-auth.js` | 41 comprobaciones de la capa de API keys. Arranca y para sus propios servidores, porque lo que se prueba es cómo se comporta el servidor en cada `API_KEY_MODE`. | Solo si cambias el manejo de keys. |

Ni el SDK ni el MCP hacen falta para usar la API, y la web no carga ninguno de los dos.

### Lista completa de archivos

```
src/
  server.js          App Express, middleware y manejo de errores
  roblox.js          Todos los endpoints de Roblox en un solo sitio
  cache.js           Caché con TTL y deduplicación de peticiones
  ratelimit.js       Rate limiting por IP y por key
  apikey.js          Comprobación de keys, modos y bloqueos por dominio
  config.js          Configuración desde el entorno
  errors.js          Helpers de error
  routes/games.js    Rutas de la API
  routes/template.js Placeholders, juegos por creador, tendencia
  routes/headers.js  Helper de Cache-Control
  fields.js          Catálogo de nombres de variable válidos
  template.js        Motor de renderizado de {{placeholders}}
  normalize.js       Respuesta de Roblox al formato de esta API (compartido)
public/
  index.html         Página de documentación + playground en vivo
  demo.html          Demo en vivo de todas las sintaxis
  theme.css          Sistema de diseño compartido (claro + oscuro)
  site.js            Cambio de tema, botones de copiar, pestañas, menú activo
extras/
  sdk/index.js         SDK de Node (publicable como paquete propio)
  mcp/server.js        Servidor MCP para agentes de IA
  tests/smoke.js       Tests de endpoints
  tests/smoke-sdk.js   Tests del SDK y del manejo de errores
  tests/smoke-mcp.js   Tests del protocolo MCP
  tests/smoke-auth.js  Tests de API keys y de modos
```

Todos los endpoints de Roblox viven en `src/roblox.js`. Roblox cambia su API sin avisar, y cuando algo se rompe quieres tener un archivo donde mirar, no veinte.

**"¿Qué archivos necesito?"** Para *usar* la API, exactamente uno: `roblox-stats.js` (o ninguno, si apuntas la etiqueta a una instancia pública). Todo lo que hay dentro de `src/` es el servidor: la parte que despliegas una vez para que otros puedan llamarla. Los módulos son pequeños y cada uno hace una cosa (hablar con Roblox, cachear, formatear respuestas), que es la forma normal de un proyecto en Node y es lo que evita que un archivo se convierta en un muro de código.

El catálogo de variables vive en `src/fields.js` y está copiado en `roblox-stats.js`, porque un script de navegador no puede importar módulos del servidor. `npm test` compara las dos listas, así que no pueden separarse y dejar `{{playing}}` funcionando en curl pero en blanco en una página real.

## Notas y limitaciones

- **Los datos no son exactamente en tiempo real.** La API de Roblox va con retraso: `playing` suele ir de 10 a 30 segundos por detrás de la web de roblox.com.
- **`playing` y `visits` son cosas distintas.** `playing` es quién está conectado ahora, `visits` es el total histórico. No son comparables.
- **`playing` es `null` en los listados de creador.** El endpoint de "juegos de un creador" de Roblox no publica contadores de jugadores, así que esta API devuelve `null` en vez de inventar un `0`. Añade `?includeStats=true` para rellenarlos con una petición extra.
- **Los endpoints de creador solo aceptan ciertos tamaños de página.** Roblox permite 10, 25, 50 o 100. Otros valores se redondean hacia arriba al siguiente permitido en vez de fallar.
- **El trending es un ranking por popularidad, no una lista curada.** Roblox retiró su API pública de explore, así que esto ordena resultados de búsqueda en vivo por jugadores. Refleja lo que la gente está jugando, no una lista editorial de "juegos top".
- **No hay lista de servidores activos.** `games/{id}/servers/Public` se retiró de la API pública de Roblox y necesita clave de developer, así que este proyecto no lo expone.
- **Los precios de los game passes cuestan peticiones extra.** No están en el endpoint de listado, así que necesitan una consulta por pass. Desactivados por defecto, se activan con `?includePrices=true`.
- **Los badges pueden ser escasos.** El endpoint público solo devuelve lo que Roblox expone.
- **Sin afiliación con Roblox.** Es un proyecto no oficial que usa las APIs públicas de Roblox.

## Contribuir

Issues y pull requests bienvenidos. Si un endpoint empieza a dar errores, casi siempre es un cambio del lado de Roblox: abre un issue con el endpoint y el error y se puede actualizar en `src/roblox.js`.

## Licencia

MIT, con una condición: **el aviso "Made by Moonlight Studios" debe seguir visible** cuando uses
`roblox-stats.js` en un sitio web. El archivo lo comprueba solo — si borras o escondes la pegatina,
deja de pedir datos — así que no hay nada que controlar. Puedes cambiar el texto o el enlace en el
objeto `CREDIT`, al principio del archivo, y apuntar `SITE_URL` a tu propio sitio.

Los endpoints de la API no tienen ese requisito: llámalos directamente desde tu código como quieras, con
key o sin ella.
