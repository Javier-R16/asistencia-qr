# Asistencia QR

Control de asistencia con carnet y código QR para **colegios** (alumnos) y **empresas** (colaboradores).
Datos en **Google Sheets**; la lógica corre en **Apps Script**; la app es un solo `index.html`.

## Qué hace

- **Diseñador de carnets** con vista previa en tiempo real: nombre de la institución, logo, 3 colores y texto al pie.
- **Carnets en PDF**: hoja carta, 9 por página, tamaño tarjeta real (5.4 × 8.56 cm), con línea de corte. Se filtra por grado/sección o departamento/cargo.
- **QR único por persona**: es un código aleatorio, no el ID, así que no se puede falsificar. Si alguien pierde el carnet, el botón «Carnet perdido» genera un QR nuevo y el viejo deja de funcionar.
- **Escáner con cámara** (celular, tablet, laptop o PC): muestra foto y nombre, suena y vibra, marca «A tiempo» o «Tarde» y se cierra solo para pasar al siguiente. Si alguien escanea dos veces, avisa sin duplicar el registro.
- **Modo «Entrada y salida»** para empresas: el primer escaneo del día es la entrada y el siguiente, la salida.
- **Panel del día**: inscritos, presentes, llegaron tarde, ausentes (con nombres), avance por grado y últimos registros. Se actualiza cada 30 segundos.
- **Exportar a CSV (Excel)** por rango de fechas. Todo queda además en la hoja «Asistencias».
- **Importar desde Excel**: copias y pegas las columnas.
- **Dos claves**: administrador (todo) y escáner (solo marcar y ver el panel), para porteros y docentes.

## Instalación (unos 10 minutos)

1. **Crea la hoja**: un Google Sheets nuevo, con nombre como «Asistencia - Colegio Valle Alto».
2. **Pega el backend**: en la hoja, ve a *Extensiones → Apps Script*, borra lo que haya, pega `Code.gs` y guarda.
3. **Instala**: elige la función `instalar` y pulsa *Ejecutar*. Autoriza los permisos (Sheets y Drive para las fotos). Se crean las hojas Config, Personas y Asistencias, y las claves aparecen en el registro (y en el menú *Asistencia QR → Ver claves*).
4. **Publica la API**: *Implementar → Nueva implementación → Aplicación web*.
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**

   Copia la URL que termina en `/exec`.
5. **Publica la app**: sube `index.html` a un repositorio de GitHub y activa GitHub Pages (o usa Cloudflare Pages). La cámara necesita **https**, así que no funciona abriendo el archivo directamente desde el disco.
6. **Entra**: abre la app, pega la URL `/exec` y la clave de administrador.

> Si cambias `Code.gs`, publícalo con *Implementar → Gestionar implementaciones → Editar → Nueva versión* para que la URL `/exec` siga siendo la misma.

## App Android (APK)

Cada cambio en `android/` compila la APK automáticamente con GitHub Actions y la publica en **Releases → «Asistencia QR (APK para Android)»**. La app abre el sistema ya conectado a tu hoja, pide permiso de cámara, guarda los Excel en Descargas e imprime los carnets con el servicio de impresión de Android. La dirección que abre está en `android/app/src/main/res/values/strings.xml` (`app_url`); para otro cliente cambia el `api=`.

## Para los equipos de la entrada

En *Ajustes → Enlace para los equipos de escaneo* está el enlace `…/index.html?api=…`. Ábrelo en el celular o tablet de la puerta, entra con la **clave de escáner** y pulsa «Iniciar cámara».

## Venderlo a varios colegios o empresas

El `index.html` es el mismo para todos. Cada cliente tiene su propia hoja:

1. Deja una hoja «plantilla» ya instalada.
2. Por cada cliente: *Archivo → Hacer una copia* (el script se copia junto con la hoja), ejecuta `instalar` en la copia, que genera claves nuevas, e impleméntala como aplicación web.
3. Entrégale su enlace: `https://TU-USUARIO.github.io/asistencia-qr/?api=URL_DEL_CLIENTE`.

Así los datos de cada cliente quedan separados, en su propia hoja de cálculo. Si el cliente prefiere, la copia puede vivir en su propia cuenta de Google.

## Archivos

| Archivo | Para qué |
|---|---|
| `Code.gs` | Backend: va en Apps Script, dentro de la hoja |
| `index.html` | App web completa (GitHub Pages) |

## Notas

- Las fotos se reducen en el navegador (420 px) y se guardan en una carpeta de Drive compartida por enlace. También puedes pegar un enlace de Drive en la columna FotoURL.
- Si la organización de Google Workspace no permite compartir archivos por enlace, las fotos no se verán fuera de la cuenta. Con Gmail normal no hay problema.
- La hora la pone el servidor (zona horaria del proyecto de Apps Script). Revísala en *Configuración del proyecto*; para Panamá debe ser `America/Panama`.
