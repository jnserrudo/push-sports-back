/**
 * Copia imágenes de URLs (Supabase u otras) al disco local y reescribe imagen_url.
 * Por defecto DRY-RUN.
 *
 *   node prisma/migrate_images_to_local.js
 *   node prisma/migrate_images_to_local.js --execute
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');

const uploadsRoot = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const destDir = path.join(uploadsRoot, 'productos');
const publicBase = (process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || 'https://pushsport.com.ar').replace(/\/$/, '');

const parseUrls = (imagen_url) => {
    if (!imagen_url) return [];
    try {
        const parsed = JSON.parse(imagen_url);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [String(parsed)];
    } catch {
        return imagen_url ? [imagen_url] : [];
    }
};

const isLocal = (url) => String(url).includes('/uploads/productos/');

const download = async (url) => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const safeExt = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext.toLowerCase()) ? ext : '.jpg';
    const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}${safeExt}`;
    const full = path.join(destDir, filename);
    fs.writeFileSync(full, buf);
    return `${publicBase}/uploads/productos/${filename}`;
};

async function rewriteField(model, idField, rows) {
    const report = { ok: 0, skip: 0, fail: [] };
    for (const row of rows) {
        const urls = parseUrls(row.imagen_url);
        if (!urls.length) {
            report.skip += 1;
            continue;
        }
        const next = [];
        for (const url of urls) {
            if (isLocal(url)) {
                next.push(url);
                continue;
            }
            if (!EXECUTE) {
                next.push(`[DRY] ${url}`);
                continue;
            }
            try {
                next.push(await download(url));
            } catch (err) {
                report.fail.push({ id: row[idField], url, error: err.message });
                next.push(url);
            }
        }
        if (EXECUTE) {
            const value = next.length === 1 ? JSON.stringify(next) : JSON.stringify(next);
            await model.update({
                where: { [idField]: row[idField] },
                data: { imagen_url: value },
            });
        }
        report.ok += 1;
    }
    return report;
}

async function main() {
    fs.mkdirSync(destDir, { recursive: true });
    const productos = await prisma.producto.findMany({
        select: { id_producto: true, nombre: true, imagen_url: true },
    });
    const comercios = await prisma.comercio.findMany({
        select: { id_comercio: true, nombre: true, imagen_url: true },
    });

    console.log('Modo', EXECUTE ? 'EXECUTE' : 'DRY-RUN');
    console.log('Destino', destDir);
    console.log('Productos', productos.length, 'Comercios', comercios.length);

    const r1 = await rewriteField(prisma.producto, 'id_producto', productos);
    const r2 = await rewriteField(prisma.comercio, 'id_comercio', comercios);
    console.log('Productos', r1);
    console.log('Comercios', r2);

    if (!EXECUTE) {
        console.log('\nNada se escribió. Si está bien, corré:');
        console.log('  node prisma/migrate_images_to_local.js --execute');
    }
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
