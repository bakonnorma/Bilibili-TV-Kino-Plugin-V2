# Bilibili TV para Kino (v0.2.0)

Plugin comunitario, no oficial. Busca series y videos de bilibili.tv, lista los capítulos y los reproduce con subtítulos (.srt) cuando existen. Solo abre lo gratuito: el contenido VIP o bloqueado por región no se abre. Bilibili TV es un servicio de terceros: úsalo respetando sus condiciones.

## Instalar (sin programar)

1. En github.com crea un repositorio **público** nuevo (botón **+** → *New repository*), por ejemplo `kino-bilibili-tv`. No lo hagas como fork.
2. Dentro del repositorio: *Add file* → *Upload files* → sube `kino-plugin.json` y `plugin.js` → *Commit changes*.
3. En Kino: celular ☰ → Plugins → **+**; TV: Ajustes → Plugins → Agregar. Escribe `tu-usuario/kino-bilibili-tv` → Agregar → Instalar.
4. Verás una línea en rojo ("video de cualquier servidor"). Es normal aquí: los servidores de video de Bilibili cambian y no se pueden listar uno por uno.
5. Prueba en este orden: buscar un título, abrir sus capítulos, reproducir, y mirar si hay sonido y subtítulos.

Para que otros lo encuentren en "De la comunidad", agrega el topic `kino-plugin` al repositorio (engranaje de *About* → *Topics*).

## Qué cambió en 0.2.0

- `plugin.js` reescrito con las cuatro funciones (`search`, `home`, `episodes`, `resolve`) siguiendo AGENTS.md y el plugin de YouTube como modelo.
- Dos ajustes nuevos: idioma de los títulos y calidad máxima (1080p, 720p o 480p).
- Elige video AVC (H.264) cuando hay varios del mismo tamaño, porque se reproduce en más equipos. El audio va como pista externa.
- Subtítulos: solo los `.srt` y `.vtt`. Los `.ass` y `.json` de Bilibili no se pueden mostrar en Kino.
- Si la API principal falla por red, prueba el espejo `api.biliintl.com`.
- Errores en español: región, VIP y límite de consultas.
- Hosts: cada dominio lleva su versión base junto al comodín `*.` (faltaba `bilivideo.com`).

## Lo que no pude comprobar

No tuve internet para probar contra Bilibili. Corrí el validador del kit y 9 pruebas con respuestas **simuladas** (no grabadas del servicio real): pasan, pero eso no prueba que Bilibili responda con ese formato.

- **Búsqueda**: uso `/web/v2/search` y leo la respuesta de forma genérica, porque no vi su formato real. Si no sale nada, avísame.
- **Sonido**: Bilibili entrega video y audio por separado. Si el video se ve pero no suena, es lo primero que hay que ajustar.
- **Inicio**: las filas son búsquedas de "anime", "romance", "action" y "comedy" hasta confirmar el endpoint de portada.
- **Idioma**: la API solo da títulos en inglés, indonesio, malayo, vietnamita y tailandés.

## Si algo falla

Mándame el mensaje exacto que muestra Kino (texto o captura) y en qué paso falló. Cada arreglo necesita subir la `version` en `kino-plugin.json` (por ejemplo a `0.2.1`) o no llegará a nadie.

## Opcional: validar en tu computador (Node 18+)

Con esta carpeta completa (incluye `sdk/` y `test/`):

```
node sdk/validate.mjs .
node --test test/plugin.test.mjs
node sdk/run.mjs . search "naruto"
node sdk/run.mjs . episodes 's:ID_DE_SERIE'
node sdk/run.mjs . resolve 'e:ID_DE_CAPITULO'
```

Las dos primeras no necesitan internet. Las tres últimas sí: son la prueba real contra Bilibili. Si lo corres dentro del repositorio, `.gitignore` ya excluye los archivos temporales del kit.
