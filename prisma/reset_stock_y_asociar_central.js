/**
 * Pone stock en 0 y asocia todos los productos activos a casa central
 * (comercio PUSHSPORT SALTA).
 * Por defecto es DRY-RUN (no escribe).
 *
 *   node prisma/reset_stock_y_asociar_central.js
 *   node prisma/reset_stock_y_asociar_central.js --execute
 *   node prisma/reset_stock_y_asociar_central.js --associate-only
 *   node prisma/reset_stock_y_asociar_central.js --associate-only --execute
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const EXECUTE = process.argv.includes('--execute');
const ASSOCIATE_ONLY = process.argv.includes('--associate-only');
const CASA_CENTRAL_ID = '5ac9c566-d827-4c77-bc56-3f805a3b8a00';

const nameMatches = (nombre) => {
    const n = String(nombre || '').toLowerCase().replace(/\s+/g, ' ').trim();
    return n === 'push sport'
        || n === 'pushsport'
        || n === 'push sports'
        || n === 'pushsport salta'
        || n.includes('pushsport salta');
};

async function main() {
    const comercios = await prisma.comercio.findMany({
        select: { id_comercio: true, nombre: true, activo: true },
        orderBy: { nombre: 'asc' },
    });

    console.log('Comercios:');
    comercios.forEach(c => console.log(`  - ${c.nombre} (${c.id_comercio}) activo=${c.activo}`));

    const byId = comercios.find(c => c.id_comercio === CASA_CENTRAL_ID);
    const matches = byId ? [byId] : comercios.filter(c => nameMatches(c.nombre));
    if (matches.length !== 1) {
        console.error(`\nABORT: se esperaba 1 comercio PUSHSPORT SALTA y hay ${matches.length}.`);
        console.error('Confirmá el nombre exacto en la tabla COMERCIOS y no ejecutes --execute.');
        process.exit(1);
    }

    const central = matches[0];
    console.log('\nCasa Central detectada:', central.nombre, central.id_comercio);

    const [productos, variantes, invCount, invVarCount] = await Promise.all([
        prisma.producto.findMany({
            where: { activo: true },
            select: { id_producto: true, usa_variantes: true },
        }),
        prisma.productoVariante.findMany({
            where: { activo: true },
            select: { id_variante: true, id_producto: true },
        }),
        prisma.inventarioComercio.count(),
        prisma.inventarioComercioVariante.count(),
    ]);

    const existentes = await prisma.inventarioComercio.findMany({
        where: { id_comercio: central.id_comercio },
        select: { id_producto: true, id_inventario: true },
    });
    const existentesSet = new Set(existentes.map(e => e.id_producto));
    const faltantes = productos.filter(p => !existentesSet.has(p.id_producto));

    console.log('\nPlan:');
    console.log('  Productos activos', productos.length);
    console.log('  Variantes activas', variantes.length);
    console.log('  Inventarios sucursal actuales', invCount);
    console.log('  Inventarios variante actuales', invVarCount);
    console.log('  Ya asociados a casa central', existentes.length);
    console.log('  A asociar', faltantes.length);
    console.log('  Modo', EXECUTE ? 'EXECUTE (escribe)' : 'DRY-RUN (no escribe)');
    console.log('  Alcance', ASSOCIATE_ONLY ? 'solo asociar faltantes (no pisa stocks)' : 'poner todo en 0 + asociar');

    if (!EXECUTE) {
        console.log('\nNada se modificó. Si los números cierran, corré:');
        if (ASSOCIATE_ONLY) {
            console.log('  node prisma/reset_stock_y_asociar_central.js --associate-only --execute');
        } else {
            console.log('  node prisma/reset_stock_y_asociar_central.js --execute');
        }
        return;
    }

    const result = await prisma.$transaction(async (tx) => {
        let p = { count: 0 };
        let v = { count: 0 };
        let i = { count: 0 };
        let iv = { count: 0 };
        if (!ASSOCIATE_ONLY) {
            p = await tx.producto.updateMany({ data: { stock_central: 0 } });
            v = await tx.productoVariante.updateMany({ data: { stock_central: 0 } });
            i = await tx.inventarioComercio.updateMany({ data: { cantidad_actual: 0 } });
            iv = await tx.inventarioComercioVariante.updateMany({ data: { cantidad_actual: 0 } });
        }

        const creados = [];
        for (const prod of faltantes) {
            const inv = await tx.inventarioComercio.create({
                data: {
                    id_comercio: central.id_comercio,
                    id_producto: prod.id_producto,
                    cantidad_actual: 0,
                    comision_pactada_porcentaje: 0,
                    usa_desglose_variantes: !!prod.usa_variantes,
                },
            });
            creados.push(inv.id_inventario);

            if (prod.usa_variantes) {
                const vars = variantes.filter(x => x.id_producto === prod.id_producto);
                for (const vr of vars) {
                    await tx.inventarioComercioVariante.upsert({
                        where: {
                            id_inventario_id_variante: {
                                id_inventario: inv.id_inventario,
                                id_variante: vr.id_variante,
                            },
                        },
                        update: { cantidad_actual: 0 },
                        create: {
                            id_inventario: inv.id_inventario,
                            id_variante: vr.id_variante,
                            cantidad_actual: 0,
                        },
                    });
                }
            }
        }

        return { p: p.count, v: v.count, i: i.count, iv: iv.count, creados: creados.length };
    });

    const logDir = path.join(__dirname, '..', 'backups');
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, `reset_stock_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`);
    fs.writeFileSync(logFile, JSON.stringify({ central, result, at: new Date().toISOString() }, null, 2));

    console.log('\nHecho:', result);
    console.log('Log:', logFile);
}

main()
    .catch((err) => {
        console.error(err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
