const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');
const { sendWeeklyReport } = require('../services/emailService');

/**
 * Trigger manual para enviar el reporte semanal por email.
 * Solo SuperAdmins (1) y Admins (2).
 */
router.post('/send-weekly', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { sucursalId } = req.body;
        const isSuperAdmin = req.user.id_rol === 1;
        const isGlobalSupervisor = req.user.id_rol === 2 && !req.user.id_comercio_asignado;
        const targetSucursalId = (isSuperAdmin || isGlobalSupervisor) ? (sucursalId || null) : req.user.id_comercio_asignado;

        // 1. Obtener rango de fechas (últimos 7 días)
        const sieteDiasAtras = new Date();
        sieteDiasAtras.setDate(sieteDiasAtras.getDate() - 7);

        // 2. Recopilar métricas
        const [ventas, topProductosRaw, sucursalInfo] = await Promise.all([
            // Total Vendido
            prisma.ventaCabecera.aggregate({
                _sum: { total_venta: true },
                _count: { id_venta: true },
                where: {
                    fecha_hora: { gte: sieteDiasAtras },
                    ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
                }
            }),
            // Top 5 Productos
            prisma.ventaDetalle.groupBy({
                by: ['id_producto'],
                where: {
                    venta: {
                        fecha_hora: { gte: sieteDiasAtras },
                        ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
                    }
                },
                _sum: { cantidad: true },
                orderBy: { _sum: { cantidad: 'desc' } },
                take: 5
            }),
            // Info de Sucursal
            targetSucursalId ? prisma.comercio.findUnique({ where: { id_comercio: targetSucursalId } }) : null
        ]);

        // 3. Resolver nombres de productos
        const topProductos = await Promise.all(topProductosRaw.map(async (item) => {
            const prod = await prisma.producto.findUnique({ where: { id_producto: item.id_producto } });
            return {
                nombre: prod?.nombre || 'Producto Desconocido',
                cantidad: item._sum.cantidad
            };
        }));

        const reportData = {
            totalVendido: Number(ventas._sum.total_venta || 0),
            cantidadVentas: ventas._count.id_venta,
            topProductos,
            sucursal: sucursalInfo?.nombre || 'General (Todas las Sedes)'
        };

        // 4. Enviar Email
        await sendWeeklyReport(req.user.email, reportData, req.user.nombre);

        res.json({ message: 'Reporte semanal enviado con éxito a ' + req.user.email });
    } catch (error) {
        console.error('Error enviando reporte semanal:', error);
        res.status(500).json({ error: 'No se pudo enviar el reporte semanal.' });
    }
});

module.exports = router;
