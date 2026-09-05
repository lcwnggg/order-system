# Sistema B2B de pedidos y control de inventario multi-tienda

Plataforma interna de pedidos, control de stock y traslados entre tiendas para una **cadena de 7 tiendas con almacén central**. En producción desde julio de 2026, con ~300 productos catalogados y uso diario por parte de las tiendas.

**Stack:** Next.js · TypeScript · Supabase (PostgreSQL + PL/pgSQL) · Vercel

> Proyecto desarrollado de forma individual: análisis del problema, diseño del modelo de datos, desarrollo, despliegue e implantación con usuarios reales.

<img width="1350" height="761" alt="image" src="https://github.com/user-attachments/assets/eb578732-5e8f-4c37-a506-e7107314eb02" />



---

## 1. El problema

La cadena operaba con WhatsApp y llamadas telefónicas. Con una tienda funciona; con siete, deja de funcionar. Los fallos concretos detectados al analizar la operativa:

**Inventario invisible → capital inmovilizado.**
Las tiendas no tenían forma de saber qué había realmente en el almacén central. Cuando un producto se agotaba en la tienda, el personal asumía que tampoco quedaba en almacén y dejaba de pedirlo. Resultado: mercancía comprada que se quedaba parada indefinidamente. Dinero invertido que no rotaba.

**Reposición basada en suposiciones.**
La reposición la decidía la dirección estimando qué necesitaba cada tienda. El personal de tienda —que es quien ve la demanda real— no tenía canal para pedir lo que de verdad se estaba vendiendo.

**Consultas de precio repetidas.**
La mercancía nueva llega sin etiquetar. Cada producto generaba la misma pregunta por WhatsApp, tienda por tienda, cada vez.

**Peticiones que se pierden.**
Los traslados entre tiendas (una necesita un artículo que otra sí tiene) se pedían en un grupo de WhatsApp donde el mensaje quedaba enterrado bajo consultas de precio y conversación diaria. Pedidos olvidados, sin trazabilidad ni forma de saber quién debía atender qué.

A esto se sumaba que buena parte de lo que las tiendas necesitaban ni siquiera
estaba catalogado, así que no había forma de pedirlo por un canal estructurado.

**Preparación de pedidos fragmentada.**
Los pedidos llegaban a lo largo del día y sin agrupar: un artículo por la mañana, otro por la tarde. La persona de almacén tenía que volver a entrar a preparar pedidos continuamente, e identificar cada artículo a partir de fotos sueltas enviadas por chat. Con siete tiendas, el coste de coordinación se multiplicaba.

**Sin datos de rotación ni de margen.**
No existía registro de qué se vendía bien en cada tienda, ni forma rápida de saber el margen real de un producto. Las decisiones de compra se tomaban a ciegas.

---

## 2. La solución

El sistema tiene dos caras: una **consola de almacén** para la dirección y una **interfaz de tienda** para cada punto de venta, con datos y permisos distintos.

### Interfaz de tienda

**Catálogo con precios de venta.** Cada tienda accede al catálogo completo por categorías, con el precio de venta de cada artículo y el stock disponible. Elimina las consultas de precio: la información está donde se necesita, en el momento en que se necesita.

**Pedidos al almacén.** La tienda compone su pedido sobre el catálogo real, viendo lo que existe, y puede añadir una nota al pedido ("urgente", "entregar el viernes"). La reposición pasa de estimarse desde dirección a solicitarse por quien conoce la demanda.

**Pedido escrito para artículos fuera de catálogo.** No todo lo que una tienda
necesita está catalogado: piezas sueltas, protectores de modelos concretos,
referencias puntuales. La tienda puede escribir la petición en texto libre
("protector completo 16 Pro Max") y añadirla al mismo pedido. Evita que estos
casos se salgan del sistema y vuelvan al WhatsApp, que es donde se perdían antes.

**Tablón de traspasos entre tiendas.** Cuando ni la tienda ni el almacén tienen un artículo, se lanza una solicitud visible para todas las demás, que responden con «lo tengo» o «no lo tengo». Cada solicitud queda registrada con estado e historial. Sustituye al grupo de WhatsApp donde las peticiones se perdían.

**Búsqueda por escaneo.** Localización de producto escaneando su código de barras, sin teclear.

<img width="1352" height="760" alt="traspasostienda" src="https://github.com/user-attachments/assets/db4ff41e-1291-4523-abe0-fd2574eb8379" />


### Consola de almacén

**Panel de stock en tiempo real.** Productos totales, referencias con stock bajo, roturas de stock y porcentaje de stock saludable, con el detalle de qué productos requieren atención.

<img width="1352" height="760" alt="截屏2026-08-13 19 18 22" src="https://github.com/user-attachments/assets/6377d175-344a-4f32-b0eb-66df50a67480" />


**Gestión de pedidos con hoja de preparación.** Los pedidos pendientes se consolidan en una hoja imprimible agrupada **por producto** (para recorrer el almacén una sola vez) o **por tienda** (para preparar bulto a bulto), con foto de cada referencia. Un pedido consolidado sustituye al goteo de peticiones a lo largo del día.

<img width="1352" height="760" alt="pedidos" src="https://github.com/user-attachments/assets/0bea09d3-a670-4bbc-86cd-cbdcbe2c6e35" />
<img width="1352" height="761" alt="截屏2026-08-13 19 19 37" src="https://github.com/user-attachments/assets/8b3e03be-6312-45a2-b578-e07e0a9a8fd0" />


**Avisos push al móvil** en cada pedido nuevo, para no tener que estar mirando la pantalla.

**Calculadora de margen.** Precio de compra almacenado de forma privada —visible solo para la dirección, nunca para las tiendas— con cálculo de coste, ingreso y margen sobre cualquier selección de productos.

**Alta de productos por tres vías:** importación masiva desde CSV/Excel con revisión celda a celda antes de confirmar, alta manual, y **reconocimiento por IA** a partir de una o dos fotos del producto, que rellena nombre, marca, categoría y descripción.
<img width="1351" height="760" alt="截屏2026-08-13 19 18 43" src="https://github.com/user-attachments/assets/1c045bce-2759-4495-9559-ecc7c63f04fb" />

**Sección "New In" con caducidad automática.** Los productos marcados como novedad aparecen destacados durante 10 días y se retiran solos. Cumple dos funciones: dar a conocer las novedades, y **dar salida de forma dirigida a existencias paradas en almacén**. Es la respuesta directa al problema de capital inmovilizado: en lugar de esperar a que las tiendas pidan un artículo que han olvidado que existe, se les pone delante.
<img width="1351" height="759" alt="catalogo" src="https://github.com/user-attachments/assets/2101293a-93c0-4bb0-80b3-e8208658df12" />

**Gestión de categorías en dos niveles** y **gestión de cuentas de tienda**, con nombres legibles en lugar de correos.

---

## 3. Arquitectura

| Capa | Tecnología |
|---|---|
| Frontend | Next.js (App Router), TypeScript |
| Base de datos | PostgreSQL en Supabase |
| Lógica en base de datos | PL/pgSQL |
| Autenticación y roles | Supabase Auth: cuenta por tienda + rol de almacén |
| Almacenamiento de imágenes | Supabase Storage |
| Notificaciones | Web Push |
| Despliegue | Vercel (despliegue continuo desde `main`) |
| Idiomas de la interfaz | Español y chino |

---

## 4. Estado actual

- **En producción desde julio de 2026**
- **7 tiendas** operando con el sistema
- **~300 productos** en 13 categorías
- **18 pedidos** procesados y traspasos entre tiendas en uso regular
- **Más de 85 despliegues** a producción

---

## 5. Trabajo en curso

- Refuerzo de las políticas de acceso a datos a nivel de base de datos (Row Level Security), para garantizar el aislamiento estricto entre tiendas y la confidencialidad de los precios de compra
- Persistencia del precio en el momento del pedido, de modo que los pedidos históricos conserven el importe con el que se emitieron aunque el precio de catálogo cambie después
- Control de concurrencia en las actualizaciones de stock mediante transacciones, para pedidos simultáneos sobre el mismo artículo
- Informes de rotación por tienda y por categoría

---

## 6. Notas

Repositorio publicado con fines de portfolio. No contiene credenciales ni datos reales de clientes.
