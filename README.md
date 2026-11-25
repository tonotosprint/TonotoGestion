# Tonotos Gestión

Sistema de gestión para ventas, presupuestos, compras y stock con espacios separados por empresa. SQLite en `data/gestion.db` sigue siendo la base operativa del servidor; cuando Firebase está configurado, el servidor sincroniza una copia de los datos de cada empresa a Firestore bajo `tenants/{companyId}`. Los datos de cada empresa se mantienen separados en ambas capas. La aplicación web también requiere Firebase configurado para verificar la conexión a internet de cada PC cliente al menos una vez cada 72 horas.

## Requisitos e inicio

- Node.js 22.5 o superior.
- npm.

Desde PowerShell, en la carpeta del proyecto:

```powershell
npm install
npm start
```

Abrí [http://127.0.0.1:3000](http://127.0.0.1:3000). Dejá abierta la ventana del servidor mientras usás la aplicación; para detenerlo, presioná `Ctrl+C`. En Windows también podés iniciar el servidor y abrir el navegador predeterminado ejecutando `Iniciar Tonotos Gestion.bat` desde la carpeta del proyecto. Las empresas y sus usuarios se crean desde el panel global `/platform`; no hay registro público en la aplicación. No abras `public/index.html` directamente.

## Firebase y operación multiempresa

1. Copiá `.env.example` como `.env` en la carpeta del proyecto y completá `PLATFORM_ADMIN_EMAIL` y `PLATFORM_ADMIN_PASSWORD` con tus credenciales. El lanzador `Iniciar Tonotos Gestion.bat` crea el archivo `.env` y lo abre en el Bloc de notas la primera vez que se ejecuta si todavía no existe. Desde entonces, las credenciales quedan guardadas localmente y se cargan automáticamente cada vez que iniciás con el lanzador o con `npm start`. La contraseña debe tener al menos 8 caracteres.
2. En el proyecto Firebase `tonotogestion`, habilitá Cloud Firestore en modo nativo y creá una cuenta de servicio para el servidor.
3. Configurá el ID y las credenciales **solo en el entorno del servidor**. No agregues el JSON de la cuenta de servicio al repositorio ni a la aplicación web/Android. En `.env`, por ejemplo:

   ```dotenv
   FIREBASE_PROJECT_ID=tonotogestion
   GOOGLE_APPLICATION_CREDENTIALS=C:\ruta\protegida\firebase-service-account.json
   PLATFORM_ADMIN_EMAIL=tu-correo-administrador
   PLATFORM_ADMIN_PASSWORD=tu-clave-segura-de-al-menos-8-caracteres
   ```

   El archivo `.env` está excluido del control de versiones. Protegé el acceso a tu carpeta de Windows y no compartas ese archivo. En producción, cargá estas variables como secretos del proveedor de hosting y usá HTTPS. También se admite `FIREBASE_SERVICE_ACCOUNT_JSON` como secreto de entorno. Sin credenciales Firebase el servidor puede conservar los datos localmente, pero la aplicación web bloqueará el acceso hasta que Firebase esté configurado y la PC cliente complete la verificación. Si `GOOGLE_APPLICATION_CREDENTIALS` apunta a un archivo que no existe en esa PC, el servidor continúa en modo local y muestra un aviso; la verificación en línea no estará disponible. El emulador de Firestore se puede usar definiendo `FIRESTORE_EMULATOR_HOST`. Las credenciales se configuran una sola vez en la PC servidor y nunca se instalan en las PC cliente; el servidor sincroniza automáticamente las empresas al iniciar y después de cada cambio.
4. Abrí `/platform` e iniciá sesión con `PLATFORM_ADMIN_EMAIL` y `PLATFORM_ADMIN_PASSWORD`. Desde ahí se crean empresas con su primera cuenta administradora y usuarios adicionales usando usuario y contraseña, sin pedir correos electrónicos a las cuentas de empresa. También se asignan nombres visibles y se gestionan los estados **Activo**, **Suspendido** y **Cancelado**. Suspender o cancelar revoca las sesiones; al vencer la fecha límite, el acceso operativo se bloquea y aparece un aviso para abonar el servicio. Una empresa cancelada recibe un mensaje de agradecimiento si intenta iniciar sesión. La gestión de cobros es manual; no se procesan pagos automáticamente.

Las cuentas de empresa se crean desde este panel y acceden con usuario y contraseña; no hay registro público ni se requieren correos electrónicos para las cuentas de empresa. Al crear una empresa, elegí uno o varios rubros —almacén, ferretería, indumentaria, bazar, librería, perfumería, electrónica, gastronomía e imprenta/gráfica/impresión digital— para guardar sus especialidades y generar al menos **200 productos precargados por cada rubro**. El catálogo incluye presentaciones y variantes habituales; los productos son editables y empiezan con stock y precios en cero. Los nombres de usuario son únicos en todo el sistema, mientras que el nombre visible y las contraseñas se administran únicamente desde la consola global. Al eliminar un usuario, sus ventas, pedidos, presupuestos y turnos de caja conservan el historial y la atribución visible; sus referencias operativas se transfieren a otra cuenta de la empresa. Al borrar un comprobante de venta se repone el stock y el pedido o presupuesto que lo originó vuelve a quedar abierto. El panel también permite eliminar una empresa de forma permanente junto con sus usuarios y datos asociados; si Firebase está configurado, también se elimina su espacio `tenants/{companyId}`. Con Firebase configurado, el servidor sincroniza por empresa a Firestore los rubros, usuarios (sin contraseñas ni credenciales), productos y stock, ventas, compras, pagos, presupuestos, pedidos, clientes, caja, recetas, comprobantes, configuración, secuencias y auditoría. Los adjuntos de compra se guardan en partes codificadas para respetar el límite de tamaño de Firestore. La sincronización usa una cola durable local que reintenta ante errores; el panel global muestra elementos pendientes y errores. Esta función es una copia automática unidireccional: SQLite del servidor sigue siendo la fuente operativa y Firestore no restaura ni fusiona datos en otra instalación. Para que la copia esté siempre disponible, mantené Firebase configurado y usá almacenamiento persistente y copias de seguridad del servidor.

### Roles y operación

- **Admin:** acceso a todas las áreas disponibles, incluida la configuración de comprobantes.
- **Gerente:** acceso a todas las áreas operativas excepto a la configuración de comprobantes; puede borrar comprobantes de ventas.
- **Cajero:** Resumen, Ventas (pedidos), Facturación, Presupuestos, Registro diario, Caja, Cuenta corriente y Etiquetas. Puede crear pedidos, facturar y registrar cobros; no puede borrar comprobantes.
- **Vendedor:** Ventas (pedidos), Presupuestos, consulta de Cuenta corriente y Etiquetas; no puede finalizar ventas ni registrar cobros.

El panel **Ventas** crea pedidos sin descontar stock. En **Facturación**, un Cajero, Gerente o Admin puede cargar un pedido pendiente, elegir los medios de pago y concretar la venta. También se pueden convertir presupuestos abiertos. Se conserva el nombre visible del usuario que creó el pedido, se atribuye la venta a esa persona en los resúmenes y se imprime ese nombre en el comprobante.

La caja puede abrirse desde Facturación o desde el módulo **Caja**, que registra fondos iniciales, notas, ingresos/egresos, totales por medio de pago y diferencias de arqueo; conserva hasta 20 cierres anteriores. Al crear una empresa se inicia automáticamente el primer turno con saldo cero; las empresas existentes sin ningún turno también reciben esa inicialización al actualizar el servidor. Abrir la caja es opcional para vender: una venta realizada sin turno se guarda normalmente, pero no se incluye en el arqueo de caja. En Facturación se puede registrar el importe recibido en efectivo y calcular el cambio, aceptar una seña o dejar una venta fiada. Las señas y los fiados requieren un cliente registrado; sus saldos y cobros posteriores se gestionan en **Cuenta corriente**. **Etiquetas** prepara planchas múltiples A4 con cantidades por producto. En **Comprobantes**, Admin puede elegir A4 o ticket de 80 mm; los presupuestos se imprimen siempre en A4. En **Clientes**, Gerente y Admin pueden crear clientes y asignarles un descuento porcentual; al facturar, se aplica a cada producto y se suma al descuento de línea hasta un máximo total del 100 %. El botón de perfil permite a cada usuario definir su nombre visible, independiente del usuario de inicio de sesión.

### Sucursales

El inventario, las ventas y la caja se administran por sucursal, mientras que el catálogo de productos y los clientes pertenecen a la empresa. Al actualizar una instalación existente se crea **Casa Central** y se asignan allí el stock y los movimientos previos, sin eliminar el historial.

Admin puede crear sucursales y asignar a cada usuario operativo una sucursal desde **Sucursales**. Admin y Gerente pueden elegir la sucursal activa desde el selector superior; Cajeros y Vendedores quedan limitados a la sucursal asignada. En Android también se utiliza la sucursal asignada al usuario. Los reportes, pedidos, presupuestos, compras y turnos de caja operativos se muestran según la sucursal activa.

Para mover mercadería, abrí **Sucursales**, seleccioná el origen y el destino, agregá productos y cantidades, y confirmá la transferencia. La operación descuenta y acredita el stock de ambas sucursales en una sola transacción; no permite transferir más unidades que las disponibles. Las sucursales nuevas comienzan con stock cero y con la caja cerrada. La numeración de comprobantes continúa siendo secuencial para toda la empresa, aunque el historial y los reportes se separan por sucursal.

## Trabajo sin conexión

- En la aplicación web, el shell se precarga con un service worker cuando se usa HTTPS (o `localhost`). El catálogo consultado queda en IndexedDB por empresa y sucursal. Ventas, pedidos, compras, presupuestos nuevos y altas/cambios de productos se guardan en una cola local asociada a la sucursal activa y se envían en orden al recuperar conexión. La interfaz muestra operaciones pendientes; las respuestas idempotentes del servidor evitan duplicar movimientos durante reintentos.
- Cada PC cliente de la aplicación web renueva su verificación de conectividad con Firebase cada 72 horas. Puede trabajar sin internet mientras la verificación siga vigente; al vencer, se bloquea hasta recuperar internet y completar una nueva verificación.
- En Android, el catálogo queda en caché por servidor, empresa y sucursal asignada; las ventas registradas sin conexión se guardan localmente con esa sucursal para sincronizarse automáticamente al recuperar conexión mientras la sesión permanece abierta. Si se cierra o reinicia la app sin conexión, será necesario volver a conectarse e iniciar sesión para reanudar la sincronización. Las contraseñas y los tokens de sesión no se persisten en la cola.
- Las operaciones pendientes solo se pueden enviar con una cuenta autorizada de la misma empresa. Conservá el almacenamiento local del navegador/dispositivo hasta que la cola indique cero pendientes. El modo offline no permite abrir comprobantes remotos ni usar acciones no disponibles en el cliente móvil.

### Varias PC en la misma red

Usá una sola PC como servidor (por ejemplo, la de caja): configurá HTTPS una vez ejecutando `Configurar HTTPS LAN.bat`, seleccioná la IPv4 de esa PC y reservá esa dirección en el router para que no cambie. El certificado vence a los tres años; si cambia la IP o se renueva, repetí la confianza en las PC cliente. El certificado y la clave privada se guardan en `data/tls` (excluida del control de versiones), y la configuración se guarda en `.env`. Reiniciá la aplicación con `Iniciar Tonotos Gestion.bat`; esa PC contiene la base de datos SQLite y las credenciales Firebase.

En cada PC cliente, ejecutá `Conectar Tonotos Gestion.bat` e ingresá la IPv4 de la PC servidor. La primera vez, compará la huella SHA-256 que muestra el lanzador con la impresa en la consola de la PC servidor y escribe `SI` solo si coincide. Esto instala el certificado para tu usuario de Windows y abre el sistema por HTTPS; se hace una vez por cada PC/usuario. Las PC cliente solo necesitan un navegador y no deben iniciar otra instancia del servidor ni tener su propia base de datos. Cada navegador cliente debe poder conectarse a Firestore por internet al menos una vez cada 72 horas; si no logra renovar la verificación, muestra el aviso de conexión y bloquea la aplicación hasta reintentar con internet.

Antes de cambiar los navegadores del enlace HTTP al nuevo HTTPS, conectá cada PC vieja a la aplicación y espera a que su cola de sincronización offline quede en cero. HTTP y HTTPS son orígenes distintos, por lo que IndexedDB y cualquier operación pendiente de la dirección HTTP no se trasladan automáticamente al origen HTTPS.

Si Windows pregunta, permití Node.js en redes privadas. Si la conexión se bloquea, habilitá reglas de entrada TCP para los puertos 3000 (configuración inicial del certificado y Android) y 3443 (aplicación web HTTPS) en el Firewall de Windows de la PC servidor. Todas las PC deben estar en la misma red privada. El puerto `PORT` y `HOST` permiten cambiar el servidor HTTP; el HTTPS usa `HTTPS_PORT`. Para conectar un teléfono, usá la dirección HTTP local o configurá confianza del certificado en Android por separado.

## Aplicación Móvil Android (Tonotos Gestión Móvil)

En la carpeta [`android/`](file:///C:/Users/exequ/Desktop/tonotogestion2/android/) se encuentra el proyecto nativo desarrollado con Jetpack Compose y Material 3, diseñado acorde a la interfaz de escritorio de Tonotos Gestión.

### Funciones de la App Móvil:
- **Conexión Automática a PC:** Configuración fácil de la IP local de la computadora donde corre el sistema.
- **Consulta de Productos y Precios:** Búsqueda en tiempo real por nombre, SKU, marca o código de barras, filtrado por categorías e indicador de stock.
- **Registro de ventas:** permite facturar con carrito y medios de pago aunque no haya una caja abierta en el servidor; en ese caso la venta no se incluye en el arqueo de caja.
- **Sincronización con el servidor:** las ventas offline se encolan en el dispositivo y se sincronizan al recuperar conexión mientras la sesión siga activa.
- **Comprobante de Venta:** Confirmación inmediata en pantalla con el número de transacción asignado por el servidor.

La creación y conversión de pedidos, presupuestos, la gestión de clientes y la apertura/cierre de caja se realizan desde la aplicación web; esas vistas todavía no están disponibles en Android.

## Datos y copias

La base principal está en `data/gestion.db` y permanece en el disco entre reinicios. Configurá almacenamiento persistente y copias de seguridad en el servidor de alojamiento. Protegé las copias: contienen datos del negocio y de sus usuarios.

En la PC servidor, detené primero la ventana del servidor con `Ctrl+C` y luego ejecutá `Iniciar Tonotos Gestion.bat`: antes de iniciar, el lanzador muestra una pantalla de progreso, consulta las versiones estables de GitHub, descarga el paquete si hay una nueva y verifica su huella SHA-256. Al completar, informa el resultado antes de iniciar el servidor. La actualización conserva `.env`, la base de datos, certificados y demás datos locales; luego instala las dependencias y arranca el sistema. Si GitHub no está disponible o una versión no supera la validación, se informa el problema y se inicia la versión local. El flujo funciona cuando se publica un tag `vX.Y.Z`: GitHub Actions genera automáticamente el release y su paquete `tonotos-gestion.zip`. El repositorio debe tener habilitadas las GitHub Actions y permiso para publicar releases. Al volver a iniciar sesión después de una actualización, cada empresa ve una vez un aviso con las notas del release y los mensajes de sus commits, con enlaces a GitHub. Las PC cliente no necesitan descargar el paquete: al volver a abrir o recargar la dirección del servidor reciben la versión publicada automáticamente; el service worker actualiza su caché y elimina la versión anterior. Mientras el servidor está detenido, las PC cliente no pueden mostrar el progreso en vivo; verán el aviso de versión cuando el servidor vuelva a estar disponible. Los cambios compatibles de esquema se aplican al iniciar sin borrar el historial. `npm start` inicia la versión local directamente y no ejecuta el actualizador de GitHub.

## Funciones

- Acceso por usuario y contraseña protegida, con perfiles Admin, Gerente, Cajero y Vendedor. Las contraseñas deben tener al menos 8 caracteres y pueden cambiarse desde el botón de llave.
- Catálogo con SKU aleatorio sugerido al crear productos (editable), código de barras, categoría, marca, precio de compra, precios de venta enteros y existencias de hasta tres decimales. Importación de CSV/Excel y exportación a CSV.
- Facturación con búsqueda de productos, cantidades enteras, carrito editable, precios por renglón, descuentos, artículos libres, clientes y pagos divididos. El comprobante se abre en otra pestaña al registrar la venta.
- Lector de códigos de barras con cámara en Facturación, Ventas y Presupuestos. Requiere HTTPS (o `localhost`) y permiso de cámara en el navegador; cada lectura agrega una unidad al movimiento activo. Al ocultar la vista previa o cambiar de sección, la cámara sigue escaneando mientras la pestaña esté abierta; se puede desactivar desde el lector y se libera al cerrar la pestaña o la sesión.
- Pedidos de venta que conservan el usuario creador y no modifican el inventario hasta concretar la venta desde Facturación.
- Presupuestos con una interfaz de preparación similar a Ventas y búsqueda de productos. Se guardan, imprimen y convierten en ventas; no cambian ni reservan existencias hasta su conversión.
- Compras con proveedor, lugar de compra, artículos escritos manualmente y SKU opcional. Si el SKU coincide exactamente con un producto activo, aumenta su stock; sin SKU, el artículo queda solo en el historial. Se puede cambiar el costo por renglón y adjuntar un comprobante PDF, JPG, PNG o WebP de hasta 5 MB.
- Comprobantes internos de venta personalizables e imprimibles en A4 o ticket de 80 mm, sin logo institucional predeterminado. Estos comprobantes no reemplazan facturas ni comprobantes fiscales.
- Cuenta corriente para señas, fiados y cobros parciales; caja con movimientos, arqueo e historial de cierres; etiquetas de producto múltiples en A4.
- El número de una venta borrada queda disponible para reutilizarse. Los contadores de ventas no se recalculan al iniciar, por lo que un reinicio explícito de secuencia se conserva.
- Registro diario, recetas, movimientos de inventario, alertas de reposición e historial de auditoría.

## Pruebas

```powershell
npm test
```
