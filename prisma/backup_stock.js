/**
 * Solo lectura. Exporta stock actual y URLs de imagen a CSV.
 * Uso: node prisma/backup_stock.js
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const toCsv = (rows) => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
};

const parseUrls = (imagen_url) => {
    if (!imagen_url) return [];
    try {
        const parsed = JSON.parse(imagen_url);
        return Array.isArray(parsed) ? parsed.filter(Boolean) : [String(parsed)];
    } catch {
        return [imagen_url];
    }
};

async function main() {
    const outDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const prefix = path.join(outDir, `stock_${stamp}`);

    const [productos, variantes, comercios, inventarios, invVars] = await Promise.all([
        prisma.producto.findMany({
            select: {
                id_producto: true,
                nombre: true,
                stock_central: true,
                activo: true,
                imagen_url: true,
                usa_variantes: true,
            },
            orderBy: { nombre: 'asc' },
        }),
        prisma.productoVariante.findMany({
            select: {
                id_variante: true,
                id_producto: true,
                sku_variante: true,
                stock_central: true,
                activo: true,
            },
        }),
        prisma.comercio.findMany({
            select: { id_comercio: true, nombre: true, activo: true, imagen_url: true },
            orderBy: { nombre: 'asc' },
        }),
        prisma.inventarioComercio.findMany({
            include: {
                comercio: { select: { nombre: true } },
                producto: { select: { nombre: true } },
            },
        }),
        prisma.inventarioComercioVariante.findMany({
            include: {
                variante: { select: { sku_variante: true, id_producto: true } },
                inventario_padre: {
                    include: {
                        comercio: { select: { nombre: true } },
                        producto: { select: { nombre: true } },
                    },
                },
            },
        }),
    ]);

    const imageRows = [];
    for (const p of productos) {
        for (const url of parseUrls(p.imagen_url)) {
            imageRows.push({ tipo: 'producto', id: p.id_producto, nombre: p.nombre, url });
        }
    }
    for (const c of comercios) {
        for (const url of parseUrls(c.imagen_url)) {
            imageRows.push({ tipo: 'comercio', id: c.id_comercio, nombre: c.nombre, url });
        }
    }

    const files = {
        [`${prefix}_productos.csv`]: toCsv(productos.map(p => ({
            id_producto: p.id_producto,
            nombre: p.nombre,
            stock_central: p.stock_central,
            usa_variantes: p.usa_variantes,
            activo: p.activo,
        }))),
        [`${prefix}_variantes.csv`]: toCsv(variantes),
        [`${prefix}_comercios.csv`]: toCsv(comercios.map(c => ({
            id_comercio: c.id_comercio,
            nombre: c.nombre,
            activo: c.activo,
        }))),
        [`${prefix}_inventario_sucursal.csv`]: toCsv(inventarios.map(i => ({
            id_inventario: i.id_inventario,
            sucursal: i.comercio?.nombre,
            id_comercio: i.id_comercio,
            producto: i.producto?.nombre,
            id_producto: i.id_producto,
            cantidad_actual: i.cantidad_actual,
        }))),
        [`${prefix}_inventario_variantes.csv`]: toCsv(invVars.map(v => ({
            sucursal: v.inventario_padre?.comercio?.nombre,
            producto: v.inventario_padre?.producto?.nombre,
            sku: v.variante?.sku_variante,
            cantidad_actual: v.cantidad_actual,
        }))),
        [`${prefix}_imagenes_urls.csv`]: toCsv(imageRows),
    };

    for (const [file, content] of Object.entries(files)) {
        fs.writeFileSync(file, content, 'utf8');
        console.log('OK', file);
    }

    console.log('\nConteos:');
    console.log('  PRODUCTOS', productos.length);
    console.log('  VARIANTES', variantes.length);
    console.log('  COMERCIOS', comercios.length);
    console.log('  INVENTARIO_COMERCIO', inventarios.length);
    console.log('  INVENTARIO_VARIANTES', invVars.length);
    console.log('  URLs imagen', imageRows.length);
    console.log('\nCarpeta:', outDir);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
