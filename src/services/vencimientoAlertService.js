const prisma = require('../config/prisma');
const { createNotification } = require('./notificationService');

const MS_DAY = 86400000;

const toYmd = (value) => {
    if (!value) return null;
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
        return value.slice(0, 10);
    }
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
};

const isValidYmd = (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
};

const parseVencimientosInput = (raw) => {
    if (raw === undefined) return undefined;
    if (raw === null || raw === '') return [];
    const list = Array.isArray(raw) ? raw : [raw];
    const parsed = [];
    const seen = new Set();
    const max = new Date();
    max.setUTCFullYear(max.getUTCFullYear() + 20);
    const maxYmd = max.toISOString().slice(0, 10);

    for (const item of list) {
        const ymd = typeof item === 'string' ? item.trim().slice(0, 10) : toYmd(item?.fecha_vencimiento || item);
        if (!ymd) continue;
        if (!isValidYmd(ymd)) {
            const err = new Error(`Fecha de vencimiento inválida: ${ymd}`);
            err.status = 400;
            throw err;
        }
        if (ymd > maxYmd) {
            const err = new Error('La fecha de vencimiento no puede superar 20 años.');
            err.status = 400;
            throw err;
        }
        if (!seen.has(ymd)) {
            seen.add(ymd);
            parsed.push(ymd);
        }
    }
    return parsed.sort();
};

const daysUntil = (ymd) => {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const [y, m, d] = ymd.split('-').map(Number);
    const target = Date.UTC(y, m - 1, d);
    return Math.round((target - today) / MS_DAY);
};

const inAlertWindow = (ymd) => daysUntil(ymd) <= 7;

const formatEs = (ymd) => {
    const [y, m, d] = ymd.split('-');
    return `${d}/${m}/${y}`;
};

const notifyPanelAdmins = async ({ titulo, mensaje, tipo }) => {
    const users = await prisma.usuario.findMany({
        where: { activo: true, id_rol: { in: [1, 2] } },
        select: { id_usuario: true },
    });
    await Promise.all(users.map((u) => createNotification({
        id_usuario: u.id_usuario,
        titulo,
        mensaje,
        tipo,
    })));
};

const attachVencimientos = (producto) => {
    if (!producto) return producto;
    const list = (producto.vencimientos || [])
        .map((v) => toYmd(v.fecha_vencimiento))
        .filter(Boolean)
        .sort();
    const { vencimientos: _ignored, ...rest } = producto;
    return { ...rest, vencimientos: list };
};

const stripVencimientos = (producto) => {
    if (!producto) return producto;
    const { vencimientos, ...rest } = producto;
    return rest;
};

const sanitizeProducto = (producto, idRol) => {
    if (idRol === 1) return attachVencimientos(producto);
    return stripVencimientos(producto);
};

const syncVencimientos = async (id_producto, dates) => {
    const existing = await prisma.productoVencimiento.findMany({ where: { id_producto } });
    const existingMap = new Map(existing.map((e) => [toYmd(e.fecha_vencimiento), e]));
    const wanted = new Set(dates);

    for (const row of existing) {
        const ymd = toYmd(row.fecha_vencimiento);
        if (!wanted.has(ymd)) {
            await prisma.productoVencimiento.delete({ where: { id_vencimiento: row.id_vencimiento } });
        }
    }

    for (const ymd of dates) {
        if (!existingMap.has(ymd)) {
            await prisma.productoVencimiento.create({
                data: {
                    id_producto,
                    fecha_vencimiento: new Date(`${ymd}T00:00:00.000Z`),
                },
            });
        }
    }
};

const notifyDueDatesForProduct = async (id_producto, nombre) => {
    const rows = await prisma.productoVencimiento.findMany({ where: { id_producto } });
    for (const row of rows) {
        const ymd = toYmd(row.fecha_vencimiento);
        if (!inAlertWindow(ymd) || row.vencimiento_alertado_el) continue;
        const dias = daysUntil(ymd);
        const mensaje = dias < 0
            ? `${nombre} ya venció el ${formatEs(ymd)}`
            : `${nombre} vence el ${formatEs(ymd)}`;
        await notifyPanelAdmins({
            titulo: dias < 0 ? 'Producto vencido' : 'Producto por vencer',
            mensaje,
            tipo: 'VENCIMIENTO',
        });
        await prisma.productoVencimiento.update({
            where: { id_vencimiento: row.id_vencimiento },
            data: { vencimiento_alertado_el: new Date() },
        });
    }
};

const checkExpiringProducts = async () => {
    try {
        const rows = await prisma.productoVencimiento.findMany({
            where: {
                vencimiento_alertado_el: null,
                producto: { activo: true },
            },
            include: { producto: { select: { nombre: true, id_producto: true } } },
        });
        const byProduct = new Map();
        for (const row of rows) {
            const ymd = toYmd(row.fecha_vencimiento);
            if (!inAlertWindow(ymd)) continue;
            byProduct.set(row.id_producto, row.producto.nombre);
        }
        for (const [id_producto, nombre] of byProduct) {
            await notifyDueDatesForProduct(id_producto, nombre);
        }
        if (byProduct.size) console.log(`[vencimientos] productos alertados: ${byProduct.size}`);
    } catch (error) {
        console.error('[vencimientos] error en chequeo:', error.message);
    }
};

const startVencimientoJob = () => {
    checkExpiringProducts();
    setInterval(checkExpiringProducts, 12 * 60 * 60 * 1000);
};

module.exports = {
    parseVencimientosInput,
    attachVencimientos,
    sanitizeProducto,
    syncVencimientos,
    notifyDueDatesForProduct,
    checkExpiringProducts,
    startVencimientoJob,
};
