// Descarga todas las fotos de un bucket de Supabase Storage a una carpeta local.
// Lo usa la copia de seguridad semanal (.github/workflows/backup.yml).
//
//   node scripts/backup-storage.mjs <bucket> <carpeta-destino>
//
// Necesita SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en el entorno. Sin
// dependencias: solo fetch, para no tener que hacer npm ci en el runner.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [bucket, outDir] = process.argv.slice(2);
const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!bucket || !outDir || !base || !key) {
  console.error("Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/backup-storage.mjs <bucket> <dir>");
  process.exit(1);
}
const headers = { Authorization: `Bearer ${key}`, apikey: key };

async function list(prefix) {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const res = await fetch(`${base}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
    });
    if (!res.ok) throw new Error(`list ${prefix || "/"}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    for (const item of page) {
      const full = prefix ? `${prefix}/${item.name}` : item.name;
      // Las «carpetas» vienen sin id.
      if (item.id === null) files.push(...(await list(full)));
      else files.push(full);
    }
    if (page.length < 1000) return files;
  }
}

const files = await list("");
console.log(`${files.length} archivos en ${bucket}`);
let failed = 0;
for (const [i, name] of files.entries()) {
  const res = await fetch(`${base}/storage/v1/object/${bucket}/${name.split("/").map(encodeURIComponent).join("/")}`, { headers });
  if (!res.ok) {
    failed++;
    console.error(`✗ ${name}: ${res.status}`);
    continue;
  }
  const dest = path.join(outDir, name);
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${files.length}`);
}
console.log(`Hecho: ${files.length - failed} bajados, ${failed} fallidos`);
if (failed > files.length / 10) process.exit(1);
