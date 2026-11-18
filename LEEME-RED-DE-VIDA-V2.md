# Red de Vida V2 — instalación y activación

## Qué se actualizó en GitHub

Se conservaron la página y el recorrido académico original. Se añadieron:

- `redvida-v2.css` — identidad visual rojo, blanco, negro y rosa suave.
- `redvida-v2.js` — registro, inicio de sesión, perfil, contactos privados, notificaciones, reseñas, evidencias, opiniones públicas y administración.
- `supabase-redvida-v2.sql` — tablas, políticas RLS, bucket privado y función de estadísticas de administrador.
- `index.html` — carga de los módulos V2 y corrección del cierre del bloque de scripts para que Supabase y los archivos externos se carguen correctamente.

## Paso 1. Ejecutar el SQL

1. Abre tu proyecto en Supabase.
2. Entra a **SQL Editor**.
3. Abre el archivo `supabase-redvida-v2.sql`.
4. Copia todo el contenido, pégalo en una consulta nueva y pulsa **Run**.
5. Revisa que no aparezcan errores.

Este script crea las tablas `profiles`, `trusted_contacts`, `notifications`, `support_resources`, `reviews` y `usage_events`. También crea un bucket privado llamado `redvida-evidence` y sus políticas de acceso.

## Paso 2. Crear la cuenta administradora

1. Abre Red de Vida y registra tu cuenta con tu correo.
2. Confirma el correo, si Supabase tiene activada la confirmación de email.
3. Vuelve a Supabase → SQL Editor.
4. Sustituye `TU_CORREO@EJEMPLO.COM` por el correo exacto con el que te registraste y ejecuta:

```sql
update public.profiles p
set role = 'admin'
from auth.users u
where p.id = u.id
  and lower(u.email) = lower('TU_CORREO@EJEMPLO.COM');
```

5. Cierra sesión en Red de Vida y vuelve a ingresar. La sección de administración aparecerá al cargar el perfil con rol `admin`.

**Importante:** no habilites una opción de registro público que permita escoger rol. Los usuarios nuevos reciben el rol `user` automáticamente. Solo un administrador o una operación segura de base de datos debe asignar el rol `admin`.

## Paso 3. Verificar la configuración de Supabase

El archivo actual `database-config.js` ya contiene la URL del proyecto y una clave publicable. Las claves publicables están diseñadas para uso en el navegador, pero la seguridad real depende de las políticas RLS de la base de datos. Nunca pegues una `service_role` key en JavaScript ni la publiques en GitHub.

En Supabase → Authentication → URL Configuration, agrega como URL de sitio y URL permitida:

```text
https://hajwdldhd.github.io/Red-de-vida-/
```

Comprueba también la configuración de confirmación de correo y recuperación de contraseña antes de usar cuentas reales.

## Paso 4. Probar la plataforma

Prueba con dos cuentas distintas:

- Crear una cuenta e iniciar sesión.
- Añadir, editar y eliminar contactos.
- Cerrar sesión y volver a entrar para comprobar que los datos persisten.
- Enviar una reseña con estrellas y comentario.
- Subir una imagen JPG, PNG o WebP de máximo 5 MB.
- Comprobar que la reseña aparece como pendiente y no en la sección pública.
- Ingresar con la cuenta administradora y aprobar/rechazar la reseña.
- Autorizar una reseña para publicación y comprobar que aparece en la galería pública.
- Crear y administrar recursos desde el panel.
- Comprobar que los avisos se guardan en la cuenta.

Usa una imagen de prueba sin rostros, documentos, números telefónicos, mensajes privados ni otra información sensible.

## Qué está implementado y qué necesita configuración

- Interfaz y módulos V2: publicados en el repositorio.
- Registro e inicio de sesión: depende de ejecutar el SQL y configurar Authentication.
- Contactos, reseñas, notificaciones y recursos: dependen de ejecutar el SQL y las políticas RLS.
- Evidencias: dependen del bucket privado y sus políticas.
- Panel de administración: requiere promover manualmente la cuenta autorizada a `admin`.
- Estadísticas: usan consultas reales de la base de datos.
- Inteligencia Artificial: no está conectada todavía; se mantiene como mejora futura, sin simular resultados.

## Límites importantes

Red de Vida continúa siendo un prototipo académico. El flujo de solicitud de apoyo original sigue siendo una demostración: no envía mensajes a contactos ni contacta automáticamente a instituciones. No debe presentarse como un servicio clínico ni como una plataforma de emergencias.

Antes de usar información personal real, revisa las políticas de privacidad, consentimiento, retención de datos y seguridad con el responsable del proyecto.
