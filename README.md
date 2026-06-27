# Immobil-IA

MVP de Immobil-IA con dos superficies separadas:

- **Programa local del cliente**: app Tauri que corre en el PC del agente inmobiliario.
- **Panel web administrativo**: app web dockerizada para administradores de Immobil-IA.

## Que incluye

- App desktop de cliente preparada para Tauri v2 con React, TypeScript, Tailwind CSS y Zustand.
- Dashboard operativo con selector de Agentes WS, captura manual de inmuebles/leads y panel HITL.
- Motor de plantillas con variables seguras como `[Nombre_Lead]`, `[Tipo_Inmueble]`, `[Zona]`, `[Precio]` y `[Nombre_Agente]`.
- Backend Rust/Tauri con comandos IPC, SQLite local mediante `sqlx` y calculo ponderado de similitud 30% GPS, 40% visual y 30% caracteristicas.
- Agente WS local con Node.js, Express, TypeScript y Puppeteer stealth preparado para modo mock o live.
- Panel web administrativo dockerizado para planes, usuarios, proxies residenciales, proveedores NLP y politicas operativas.
- Arquitectura thick client + thin server: el PC del usuario ejecuta UI, SQLite, scraping y ML; la nube administra acceso, suscripciones y tokens temporales de proxies.

## Requisitos

- Node.js 22+
- Docker Desktop para correr el panel administrativo y el Agente WS local durante el MVP
- Rustup + Cargo para ejecutar o empaquetar Tauri
- En Windows: Microsoft C++ Build Tools

En este equipo se detecto Node y Docker, pero no Rust/Cargo. Por eso la app web se puede verificar con Vite, y Tauri quedara listo al instalar Rust.

## Ejecutar programa local del cliente

```bash
npm install
npm run dev
```

Vite abre la UI local en `http://localhost:1420`. Para verla como app de escritorio:

```bash
npm run tauri dev
```

La base SQLite se crea en el directorio de datos de la aplicacion del usuario.

El usuario cliente solo configura:

- parametros del Agente WS;
- datos personales;
- suscripcion;
- informacion de pago.

No configura proxies, claves NLP ni proveedores externos.

## Ejecutar panel web administrativo

```bash
docker compose up --build admin-panel
```

Abre `http://localhost:8080`.

Para ver metricas reales de operaciones y feedback, levanta tambien:

```bash
docker compose up --build -d postgres thin-server admin-panel
```

Este panel es para administradores de Immobil-IA. Aqui se gestionan:

- planes y limites;
- usuarios y suscripciones;
- proveedor de proxies residenciales;
- proveedores NLP externos;
- modelos de IA externos y slugs internos;
- herramientas disponibles para Agentes WS;
- rotacion de credenciales;
- notificaciones via Resend;
- feedback HITL para mejora de modelos;
- auditoria operativa minima.

El panel web esta en `admin-panel/` y se construye como imagen Docker con nginx, lista para desplegar en un VPS o proveedor cloud.
En el MVP actual, las secciones Resumen y Operacion ya consultan el thin server en `http://localhost:3000` para mostrar corridas sincronizadas y feedback HITL agregado.

## Ejecutar thin server y Postgres

```bash
docker compose up --build -d postgres thin-server
```

Endpoints iniciales:

- `GET http://localhost:3000/health`
- `POST http://localhost:3000/feedback/events`
- `POST http://localhost:3000/agent-runs/completed`
- `POST http://localhost:3000/nlp/extract`
- `POST http://localhost:3000/proxy/token`
- `GET http://localhost:3000/admin/feedback/summary`
- `GET http://localhost:3000/admin/feedback/export`
- `GET http://localhost:3000/admin/operations/summary`
- `GET http://localhost:3000/admin/config/summary`

La app Tauri sincroniza feedback HITL pendiente hacia `IMMOBILIA_ADMIN_API_URL` de forma best-effort. Si el servidor no esta disponible, el feedback queda guardado localmente en SQLite con `synced_at` vacio y se reintentara en una ejecucion posterior.
El endpoint `GET /admin/feedback/export` descarga los eventos HITL en JSONL para auditoria o entrenamiento supervisado. Tambien acepta `?format=json` si se necesita una respuesta JSON envolvente.

Postgres se usa desde esta fase porque el thin server sera multiusuario, necesita agregados de feedback para entrenamiento y debe soportar concurrencia del panel administrativo sin migrar despues desde una base local.

El endpoint `POST /nlp/extract` recibe texto inmobiliario libre y devuelve una extraccion normalizada de lead o publicacion. Si `IMMOBILIA_NLP_PROVIDER=gemini` y `GEMINI_API_KEY` esta configurada, usa Gemini; si no, responde con un parser local deterministico y registra el evento en Postgres para auditoria.

El panel admin no muestra usuarios, proxies, modelos o herramientas simuladas. Las secciones de configuracion leen `GET /admin/config/summary`; si no hay registros reales en Postgres, aparecen vacias. Las metricas principales de publicaciones y leads usan documentos unicos observados, no la suma historica de corridas repetidas.

El endpoint `POST /proxy/token` funciona como broker minimo. Si `IMMOBILIA_PROXY_SERVER` o `IMMOBILIA_PROXY_HOST`/`IMMOBILIA_PROXY_PORT` estan configurados, devuelve una credencial temporal para Puppeteer; si no, audita la solicitud y responde modo `direct`, permitiendo que la prueba local continue sin proxy real.

Para usar Webshare como broker durante pruebas:

```env
IMMOBILIA_PROXY_PROVIDER=webshare
WEBSHARE_API_KEY=tu_api_key
WEBSHARE_PROXY_MODE=direct
WEBSHARE_COUNTRY_CODES=
```

Con esa configuracion, `POST /proxy/token` consulta la lista de proxies de Webshare, toma el primer proxy valido y lo devuelve al Agente WS con expiracion local. Si no encuentra proxy o falta la API key, el sistema vuelve a modo `direct`.

Para enviar correo al terminar una investigacion con Resend:

```env
RESEND_API_KEY=tu_api_key
RESEND_FROM_EMAIL=Immobil-IA <onboarding@resend.dev>
RESEND_TO_EMAIL=correo_verificado_para_pruebas@example.com
```

`RESEND_TO_EMAIL` es opcional, pero util durante el free tier porque fuerza un destinatario verificado. Si queda vacio, el servidor intenta usar el email del usuario local que sincroniza la corrida. Cada intento queda auditado en `notification_events` con estado `sent`, `skipped` o `error`.

## Ejecutar Agente WS local

```bash
docker compose up --build scraper-agent
```

Endpoints:

- `GET http://localhost:8787/health`
- `GET http://localhost:8787/scrape/radar-chapinero`
- `POST http://localhost:8787/scrape/radar-chapinero`

Por defecto usa `SCRAPER_MODE=mock`, que devuelve documentos simulados sin tocar sitios externos. En modo real, Puppeteer sigue corriendo en el PC del usuario. El usuario no configura proxies; el cliente local solicita un token temporal al servidor administrado por Immobil-IA.

Cuando el radar se ejecuta con `IMMOBILIA_NLP_PROVIDER` distinto de `none`, el Agente WS envia el texto crudo de cada documento a `IMMOBILIA_ADMIN_API_URL/nlp/extract` y fusiona la respuesta con la extraccion local. Si el thin server o el proveedor externo fallan, conserva los datos extraidos localmente.

Para una prueba mas realista con Tavily Search:

```env
SCRAPER_MODE=live
SCRAPER_DISCOVERY_PROVIDER=tavily
TAVILY_API_KEY=tu_api_key
TAVILY_MAX_RESULTS=10
TAVILY_SEARCH_DEPTH=basic
TAVILY_ENABLE_SOCIAL_LEAD_SEARCH=true
TAVILY_SOCIAL_MAX_RESULTS=12
TAVILY_LEAD_SOURCE_DOMAINS=facebook.com,reddit.com,x.com,twitter.com,threads.net,instagram.com,tiktok.com,linkedin.com
TAVILY_ENABLE_PAGE_EXPANSION=true
TAVILY_EXPAND_SEED_LIMIT=8
TAVILY_EXTRACT_LIMIT=30
TAVILY_EXTRACT_DEPTH=basic
TAVILY_CRAWL_URLS=
```

En este modo el Agente WS consulta Tavily, deduplica resultados por URL, expande paginas semilla con Puppeteer para buscar enlaces internos de publicaciones, usa Tavily Extract sobre URLs candidatas, clasifica cada resultado como lead o publicacion con reglas locales y luego usa el NLP configurado para enriquecer campos inmobiliarios. Ademas ejecuta un carril separado de busqueda social (`TAVILY_ENABLE_SOCIAL_LEAD_SEARCH`) orientado a foros y redes donde personas publican demanda: "busco", "necesito", "presupuesto", "quien arrienda", etc. Esos resultados se marcan como candidatos a lead antes de pasar por NLP.
Las variables `TAVILY_INCLUDE_DOMAINS` y `TAVILY_EXCLUDE_DOMAINS` aceptan dominios separados por coma para acotar inventario general; `TAVILY_LEAD_SOURCE_DOMAINS` acota el carril social de leads. Antes de llamar al agente, Tauri envia las URLs locales ya guardadas para evitar resultados repetidos.
El Agente WS esta pensado para corridas diarias o semanales, asi que prioriza cobertura y utilidad sobre respuesta inmediata. En fuentes reales puede tardar varios minutos si expande portales, ejecuta Tavily Extract y pasa documentos por NLP.
Si `TAVILY_CRAWL_URLS` contiene URLs separadas por coma, el agente tambien ejecuta Tavily Crawl sobre esas fuentes y mezcla los resultados con Search. Usa `TAVILY_CRAWL_LIMIT`, `TAVILY_CRAWL_MAX_DEPTH` y `TAVILY_CRAWL_INSTRUCTIONS` para controlar esa exploracion.

## Arquitectura

Consulta [docs/architecture.md](docs/architecture.md) para el modelo detallado:

- Cliente local: Tauri, React, SQLite, Puppeteer y ONNX local.
- Panel admin web: usuarios, planes, proxies, NLP y credenciales.
- Thin server: autenticacion, planes y broker de proxies.
- APIs externas: NLP y asistente de plantillas bajo demanda.

Los modelos locales viven por defecto en `models/post_comparer.onnx` y `models/matchmaker.onnx`. Tauri los carga con ONNX Runtime y registra `modelRuntime`/`modelPath` en cada sugerencia generada. Si un modelo no esta disponible o falla la carga, la app conserva el scorer deterministico de Rust como fallback para no bloquear la operacion local. Las rutas pueden sobreescribirse con `IMMOBILIA_POST_COMPARER_MODEL_PATH` e `IMMOBILIA_MATCHMAKER_MODEL_PATH`.

## Estructura

```text
src/                 Frontend React del cliente local
src-tauri/           Backend Tauri/Rust + SQLite IPC
admin-panel/         Panel web administrativo dockerizable
scraper-agent/       Sidecar local Node/Express/Puppeteer
docker-compose.yml   Orquestacion local del panel admin y del Agente WS durante el MVP
```

## Siguiente paso tecnico

La integracion ONNX local ya apunta a los contratos de `models/model_contract.md`. El siguiente avance del roadmap es recolectar feedback HITL suficiente, entrenar reemplazos reales manteniendo el mismo input/output y comparar su precision contra las lineas base deterministicas actuales.
