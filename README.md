# NutriDiario — Registro diario de alimentos (Laragon 100% Apache)

Aplicación web para registrar alimentos. **100% Apache/Laragon** con backend PHP que proxy a FatSecret. Sin `npm`/`Node`. Los registros del usuario siguen en `localStorage`; las credenciales de FatSecret están en `config.php` (server-side, no expuestas).

> Reestructuración: se abandona "solo frontend para GitHub Pages". FatSecret exige IP whitelist + CORS, inviable puro frontend. Ahora el backend es `proxy.php` + `cache/token.json` sobre Apache.

## Estructura
```
comida/
├── proxy.php              # Backend: /proxy.php?action=health|search|food (usa config.php + cache)
├── config.php             # (no commitear) con FATSECRET_CLIENT_ID/SECRET
├── config.php.example     # plantilla
├── cache/
│   ├── .htaccess          # Deny from all
│   └── token.json         # cache token 23h (gitignored)
├── index.html
├── css/styles.css, responsive.css
├── js/
│   ├── api.js             # cliente de proxy.php (sin EXTERNAL_PROXIES, sin secrets)
│   ├── app.js             # debounce + health check a proxy.php
│   ├── storage.js, nutrition.js, history.js, import-export.js, ui.js, three-background.js
├── assets/ejemplo-import.json
└── README.md
```

## Requisitos
- Laragon con Apache + PHP 8.3 (ya lo tienes) + `php_curl` habilitado
- Credenciales FatSecret de https://platform.fatsecret.com

## Configuración (una vez)

1. Copia `config.php.example` a `config.php` y completa:
```php
<?php return ['client_id'=>'TU_ID','client_secret'=>'TU_SECRET'];
```

2. Asegúrate de que `cache/` sea escribible (Laragon en Windows ya lo es). El token se cachea 23h en `cache/token.json`.

3. Whitelistea **la IP del servidor Apache** (no tu browser, no proxies externos volátiles como `50.114.185.55`):
   - Averigua tu IP pública: https://ifconfig.me
   - En FatSecret Dashboard → tu app → **Manage Keys → IP Ranges** → agrega `TU_IP/32` (ej `181.xxx.xxx.xxx/32`)

## Ejecución (Laragon)

- Inicia Apache en Laragon
- Abre **http://localhost/comida/** o **http://comida.test/** (virtual host)
- No uses `python -m http.server` ni `file://` (no ejecutan PHP)
- Prueba health: `http://localhost/comida/proxy.php?action=health` → `{"ok":true,"hasCreds":true}`

## Flujo
```
Browser --fetch--> proxy.php?action=search&q=yerba  (mismo origen, sin CORS)
Apache/PHP --Basic--> POST https://oauth.fatsecret.com/connect/token (cache 23h)
Apache/PHP --Bearer--> POST https://platform.fatsecret.com/rest/server.api (AR/es)
Browser <--JSON-- {foods, totalHits}
```

## Deploy
Ya no es GitHub Pages (estático). Opciones 100% Apache:
- Hosting compartido PHP: sube `proxy.php`, `config.php`, `cache/` con permisos escritura.
- Laragon en VPS: mismo flujo.

## Seguridad
- `config.php` y `cache/token.json` están gitignored y con `.htaccess` (no servidos).
- Sin `Client Secret` en `localStorage` ni `js/`.
- Sin `EXTERNAL_PROXIES` (eliminados) — ya no se expone a `corsproxy.io`/`killcors` (evita `403 keyless_legacy_url` y `code 21` volátil).

## Three.js, debounce, historial
Sin cambios: fondo 3D opcional (`prefers-reduced-motion`), debounce 500 ms, paginación FatSecret `page_number` 0-based.

## Datos de ejemplo
`assets/ejemplo-import.json` con `fatsecret-*` → Importar → Combinar.

## Licencia
MIT.
