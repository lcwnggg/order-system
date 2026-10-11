# Copias de seguridad

Dos tareas automáticas en GitHub Actions (pestaña **Actions** del repo):

| Workflow | Cuándo | Qué hace |
|---|---|---|
| **Copia de seguridad** (`backup.yml`) | Cada lunes 03:00 UTC, o a mano con «Run workflow» | Vuelca la base de datos (roles, esquema, datos — incluidos los usuarios) y baja todas las fotos de `product-images`. Lo cifra todo y lo guarda 90 días como *artifact*. |
| **Mantener Supabase despierto** (`keepalive.yml`) | Cada 3 días | Una consulta para que Supabase gratis no pause el proyecto por 7 días sin uso. |

El repo es público, así que las copias van **cifradas**: sin `BACKUP_PASSPHRASE` no se pueden abrir. Guarda esa contraseña en un gestor de contraseñas; si la pierdes, las copias no sirven.

## Puesta en marcha (una sola vez)

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | De dónde sale |
|---|---|
| `SUPABASE_URL` | El mismo valor que `NEXT_PUBLIC_SUPABASE_URL` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API Keys → `service_role` |
| `SUPABASE_DB_URL` | Supabase → botón **Connect** → **Session pooler** (no «Direct connection»: GitHub no tiene IPv6). Sustituye `[YOUR-PASSWORD]` por la contraseña de la base de datos. |
| `BACKUP_PASSPHRASE` | Una contraseña larga que inventes tú |

Luego Actions → **Copia de seguridad** → **Run workflow** para probarla.

> GitHub desactiva las tareas programadas si el repo pasa 60 días sin commits; te avisa por correo y basta con volver a activarlas en Actions.

## Restaurar

1. Actions → la ejecución que quieras → baja el artifact (`backup-AAAA-MM-DD.zip`) y descomprímelo.
2. Descifra:
   ```bash
   gpg -d backup-AAAA-MM-DD.tar.gz.gpg | tar xz
   ```
3. Carga en un proyecto Supabase (nuevo o el mismo vacío), con la URL de conexión de ese proyecto:
   ```bash
   psql "$NUEVA_DB_URL" --single-transaction -v ON_ERROR_STOP=1 \
     -f AAAA-MM-DD/roles.sql -f AAAA-MM-DD/schema.sql \
     -c 'SET session_replication_role = replica' -f AAAA-MM-DD/data.sql
   ```
4. Las fotos están en `AAAA-MM-DD/storage/product-images/`: súbelas al bucket `product-images` (público) con la misma estructura de carpetas.
5. Si el proyecto es nuevo, cambia `NEXT_PUBLIC_SUPABASE_URL`, la anon key y la service role key en Vercel y vuelve a desplegar.

## ¿Y Vercel?

Vercel no borra proyectos por no usarse. El código vive en GitHub, así que basta con volver a importarlo. Lo único que no está en el repo son las **variables de entorno** de Vercel: guárdalas también en tu gestor de contraseñas.
