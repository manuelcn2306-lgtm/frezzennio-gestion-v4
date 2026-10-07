# FREZZENIO Gestión V4

V4 transforma la V3 local en una aplicación web cliente-servidor. Todos los teléfonos y ordenadores que acceden a la misma instalación trabajan contra la misma base de datos SQLite del servidor.

## Incluido
- Acceso por usuario/contraseña con contraseña hasheada (bcrypt) y sesión HTTP.
- Base de datos central SQLite con WAL y relaciones SQL.
- Ingredientes y compras vinculados por ID.
- Recetas vinculadas a ingredientes por ID.
- Órdenes de producción PLANNED -> COMPLETED.
- Al completar una orden: valida existencias, descuenta materia prima y guarda un snapshot de coste por ingrediente en `production_cost_trace`.
- Stock terminado = producción completada - ventas.
- Ventas con snapshot del coste unitario.
- Movimiento automático de caja para compras (OUT), ventas no a crédito (IN) y gastos (OUT).
- Referencias de caja al documento origen mediante `ref_type` y `ref_id`.
- Interfaz responsive para móvil y ordenador.

## Arranque local
1. Instale Node.js 20+ y npm.
2. Copie `.env.example` a `.env` o defina las variables en su entorno.
3. Ejecute `npm install`.
4. Ejecute `node init-db.js`.
5. Ejecute `node server.js`.
6. Abra `http://localhost:3000`.

El usuario inicial por defecto es `admin` y la contraseña por defecto es `Cambiar123!` SOLO si no define ADMIN_USER/ADMIN_PASSWORD al inicializar. Cambie esta configuración antes de un despliegue real.

## Docker
Defina al menos `SESSION_SECRET`, `ADMIN_USER` y `ADMIN_PASSWORD`, después ejecute `docker compose up --build`.

## Sincronización entre dispositivos
No requiere sincronización manual: los clientes consultan y escriben al mismo servidor por la API. Para uso desde varios dispositivos, publique esta aplicación en un servidor accesible por HTTPS y haga que todos los dispositivos usen la misma URL.

## Seguridad / producción
Este paquete es una base funcional desplegable, no una auditoría de seguridad. Para Internet público añada HTTPS mediante un proxy/hosting gestionado, gestione secretos fuera del código, implemente copias de seguridad del archivo de base de datos, registro/auditoría, recuperación de contraseña y política de usuarios. SQLite es adecuado para una instalación pequeña; si el volumen/concurrencia crece, migre el esquema a PostgreSQL.

## Modelo de coste
La valoración vigente de receta usa la compra más reciente de cada ingrediente. Al completar una orden de producción, V4 congela la cantidad usada, coste unitario y coste total de cada ingrediente. Esto crea trazabilidad histórica aun si cambia el precio posteriormente.

## Caja automática
- Compra: salida en Caja/cuenta elegida.
- Venta no crédito: entrada en Caja/cuenta elegida.
- Venta a crédito: no genera entrada inmediata.
- Gasto: salida en Caja/cuenta elegida.
