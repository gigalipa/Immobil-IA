# Arquitectura operativa v0.1

Immobil-IA usa un modelo **thick client + thin server** con dos superficies separadas:

- **Programa local del cliente**: app Tauri que usa el agente inmobiliario.
- **Panel web administrativo**: app web dockerizada que usan los administradores de Immobil-IA.

La aplicacion de escritorio hace el trabajo pesado en el PC del agente inmobiliario; el servidor central solo administra acceso, plan y credenciales temporales para proxies o APIs externas.

## 1. Borde: PC del usuario

El borde ejecuta aproximadamente el 90% del sistema:

- **Dashboard y UI**: Tauri + React en la maquina del usuario.
- **Base de datos local**: SQLite guarda radares, publicaciones, inmuebles consolidados, leads, plantillas y decisiones HITL.
- **Agente WS local**: Puppeteer corre localmente. El PC del usuario renderiza portales, grupos y foros.
- **Cross-referencing local**: los modelos `.onnx` se ejecutan en Rust con CPU local para calcular similitud GPS, visual y de caracteristicas.
- **Human-in-the-loop**: el usuario confirma, rechaza o relaciona inmuebles desde la app local.

La nube no recibe ni procesa bases completas de inmuebles o leads.

## 2. Nube ligera: servidor central

El servidor central no ejecuta bots ni procesa inventario inmobiliario. Sus responsabilidades son:

- **Autenticacion**: correo, password o magic link.
- **Suscripciones**: plan Basico, Pro o Premium y limites de uso.
- **Licenciamiento**: habilitar o bloquear radares segun plan.
- **Broker de proxies residenciales**: emitir tokens temporales para que el Agente WS local use una IP residencial administrada por Immobil-IA.
- **Auditoria minima**: eventos de acceso, consumo de proxy y estado de suscripcion.

No debe almacenar HTML crudo, fotos, leads completos ni inventario extraido salvo que una version futura lo requiera con consentimiento explicito.

## 2.1 Panel web administrativo

El panel web administrativo corre en Docker y puede desplegarse en cualquier servidor cloud. Lo usan solo administradores de Immobil-IA.

Responsabilidades del panel:

- gestionar usuarios, planes, limites y estados de pago;
- configurar pools de proxies residenciales;
- configurar proveedores NLP y claves API;
- registrar modelos de inferencia externos y slugs internos;
- registrar herramientas externas que los Agentes WS pueden solicitar;
- rotar credenciales;
- revisar consumo de tokens de proxy y llamadas externas;
- revisar notificaciones por Resend;
- monitorear feedback HITL recibido para mejora de modelos;
- operar auditoria minima.

El usuario cliente no ve ni configura proxies, claves NLP ni proveedores externos desde la app local.

## 3. APIs externas

Las APIs externas son auxiliares y se usan solo para tareas que no conviene correr localmente:

- **NLP avanzado**: convertir texto desordenado en JSON estructurado.
- **Asistente de plantillas**: mejorar tono, adaptar mensajes y resumir informacion.
- **Clasificacion de intencion**: detectar si una persona es propietario, arrendador, comprador o arrendatario.

Para minimizar exposicion de datos, se debe enviar solo el fragmento necesario, por ejemplo el texto bruto de una publicacion, no toda la base local.

## Flujo de scraping con proxy

1. El Agente WS local decide ejecutar una busqueda.
2. Solicita al thin server un token temporal de proxy y las APIs/herramientas autorizadas segun el plan del usuario.
3. El thin server valida suscripcion y devuelve credenciales temporales o endpoints habilitados.
4. Puppeteer corre en el PC del usuario usando ese proxy.
5. El Agente WS recoge informacion, la organiza y la guarda en SQLite local.
6. El modelo local **PostComparer** compara publicaciones para detectar inmuebles con multiples publicaciones y generar verificacion HITL.
7. El modelo local **MatchMaker** cruza inmuebles disponibles con leads compradores/arrendatarios y alimenta el Feed de prospeccion.
8. Al completar la investigacion, la app muestra una notificacion local.
9. El cliente envia una orden al servidor para enviar un correo via Resend: el Agente WS `nombre_del_agente` termino su investigacion.

## Flujo de feedback y mejora de modelos

1. El usuario revisa comparaciones y matches propuestos por PostComparer y MatchMaker.
2. Marca resultados positivos o negativos en la app local.
3. La app envia al servidor feedback minimo y metadatos de entrenamiento, evitando subir la base local completa.
4. El servidor agrega feedback de todos los clientes.
5. El equipo/admin procesa ese conjunto para mejorar los modelos ML.
6. Se publica una nueva version de los modelos.
7. Cada cliente descarga la version actualizada y la ejecuta localmente.

## Resumen financiero

Costos fijos esperados:

- Base minima de usuarios y planes.
- Proveedor de proxies residenciales.
- Llamadas pay-as-you-go a APIs de IA.

Costos evitados:

- Infraestructura masiva para scraping.
- Renderizado remoto de JavaScript.
- Procesamiento centralizado de datos inmobiliarios.
- Almacenamiento cloud de leads e inventario del usuario.
