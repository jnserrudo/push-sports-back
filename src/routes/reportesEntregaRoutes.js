const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');
const { setAuditUser } = require('../services/auditService');

const generateReportNumber = async () => {
    const today = new Date();
    const prefix = `RE-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const count = await prisma.reporteEntrega.count({
        where: { numero_reporte: { startsWith: prefix } }
    });
    return `${prefix}-${String(count + 1).padStart(4, '0')}`;
};

// Crear reporte de entrega (admin / supervisor)
router.post('/', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        setAuditUser(req.user.id_usuario);

        const { id_comercio, observacion, detalles } = req.body;
        const id_usuario = req.user.id_usuario;

        const isGlobalSupervisor = req.user.id_rol === 2 && !req.user.id_comercio_asignado;
        if (req.user.id_rol !== 1 && !isGlobalSupervisor && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para crear reportes de entrega para este comercio.' });
        }

        if (!id_comercio || !Array.isArray(detalles) || detalles.length === 0) {
            return res.status(400).json({ error: 'Faltan datos requeridos o detalles inválidos.' });
        }

        const numero_reporte = await generateReportNumber();
        const total_unidades = detalles.reduce((sum, d) => sum + (Number(d.cantidad) || 0), 0);

        const result = await prisma.$transaction(async (tx) => {
            const reporte = await tx.reporteEntrega.create({
                data: {
                    id_comercio,
                    id_usuario,
                    numero_reporte,
                    observacion,
                    total_unidades
                }
            });

            const detallesData = await Promise.all(detalles.map(async (d) => {
                const { id_producto, id_variante, cantidad, precio_pushsport, precio_base, precio_venta } = d;
                if (!id_producto || cantidad === undefined || cantidad === null) {
                    throw new Error('Detalle inválido: falta id_producto o cantidad');
                }

                const producto = await tx.producto.findUnique({
                    where: { id_producto },
                    select: {
                        precio_pushsport: true,
                        costo_compra: true,
                        precio_venta_sugerido: true,
                        usa_variantes: true,
                        nombre: true
                    }
                });

                if (!producto) {
                    throw new Error(`Producto ${id_producto} no encontrado`);
                }

                let precioVenta = parseFloat(precio_venta) || parseFloat(producto.precio_venta_sugerido) || 0;
                let precioPush = parseFloat(precio_pushsport) || parseFloat(producto.precio_pushsport) || 0;
                let precioBase = parseFloat(precio_base) || parseFloat(producto.costo_compra) || 0;

                if (id_variante) {
                    const variante = await tx.productoVariante.findUnique({
                        where: { id_variante },
                        select: { precio_variante: true }
                    });
                    if (variante && parseFloat(variante.precio_variante) > 0) {
                        precioVenta = parseFloat(variante.precio_variante);
                    }
                }

                return {
                    id_reporte: reporte.id_reporte,
                    id_producto,
                    id_variante,
                    cantidad: Number(cantidad),
                    precio_pushsport: precioPush,
                    precio_base: precioBase,
                    precio_venta: precioVenta
                };
            }));

            await tx.reporteEntregaDetalle.createMany({
                data: detallesData
            });

            return reporte;
        });

        const reporteCompleto = await prisma.reporteEntrega.findUnique({
            where: { id_reporte: result.id_reporte },
            include: {
                comercio: true,
                usuario: { select: { nombre: true, apellido: true } },
                detalles: {
                    include: {
                        producto: true,
                        variante: { select: { id_variante: true, sku_variante: true, atributos_valores: true } }
                    }
                }
            }
        });

        res.status(201).json({ message: 'Reporte de entrega creado', data: reporteCompleto });
    } catch (error) {
        console.error('Error al crear reporte de entrega:', error);
        res.status(500).json({ error: error.message || 'Error interno al crear reporte de entrega.' });
    }
});

// Listar reportes de entrega
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { id_comercio, limit = 50, offset = 0 } = req.query;

        const isGlobalSupervisor = req.user.id_rol === 2 && !req.user.id_comercio_asignado;
        let where = {};
        if (req.user.id_rol !== 1 && !isGlobalSupervisor) {
            where.id_comercio = req.user.id_comercio_asignado;
        } else if (id_comercio) {
            where.id_comercio = id_comercio;
        }

        const [reportes, total] = await Promise.all([
            prisma.reporteEntrega.findMany({
                where,
                include: {
                    comercio: true,
                    usuario: { select: { nombre: true, apellido: true } },
                    detalles: {
                        include: {
                            producto: true,
                            variante: { select: { id_variante: true, sku_variante: true, atributos_valores: true } }
                        }
                    }
                },
                orderBy: { fecha_emision: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.reporteEntrega.count({ where })
        ]);

        res.json({ data: reportes, total, limit: parseInt(limit), offset: parseInt(offset) });
    } catch (error) {
        console.error('Error al listar reportes de entrega:', error);
        res.status(500).json({ error: 'Error interno al listar reportes de entrega.' });
    }
});

// Obtener reporte de entrega por ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const reporte = await prisma.reporteEntrega.findUnique({
            where: { id_reporte: id },
            include: {
                comercio: true,
                usuario: { select: { nombre: true, apellido: true } },
                detalles: {
                    include: {
                        producto: true,
                        variante: { select: { id_variante: true, sku_variante: true, atributos_valores: true } }
                    }
                }
            }
        });

        if (!reporte) {
            return res.status(404).json({ error: 'Reporte de entrega no encontrado' });
        }

        const isGlobalSupervisor = req.user.id_rol === 2 && !req.user.id_comercio_asignado;
        if (req.user.id_rol !== 1 && !isGlobalSupervisor && req.user.id_comercio_asignado !== reporte.id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para ver este reporte de entrega.' });
        }

        res.json(reporte);
    } catch (error) {
        console.error('Error al obtener reporte de entrega:', error);
        res.status(500).json({ error: 'Error interno al obtener reporte de entrega.' });
    }
});

module.exports = router;
