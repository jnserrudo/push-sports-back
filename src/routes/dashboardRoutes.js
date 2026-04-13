const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const { sucursalId } = req.query;
        const isSuperAdmin = req.user.id_rol === 1;

        // Si es Admin de Sucursal y no es SuperAdmin, forzamos sucursalId
        const targetSucursalId = isSuperAdmin ? sucursalId : req.user.id_comercio_asignado;

        // 1. Métricas Principales (Counts & Sums)
        const [totalCaja, productosCount, usuariosCount] = await Promise.all([
            // Saldo acumulado
            targetSucursalId 
                ? prisma.comercio.findUnique({ where: { id_comercio: targetSucursalId }, select: { saldo_acumulado_mili: true } })
                : prisma.comercio.aggregate({ _sum: { saldo_acumulado_mili: true }, where: { activo: true } }),
            
            // Productos activos
            prisma.producto.count({ where: { activo: true } }),
            
            // Usuarios activos
            prisma.usuario.count({ where: { activo: true } })
        ]);

        // 2. Stock Crítico (Top 3 productos con menos stock en la sucursal o global)
        const stockCritico = await prisma.inventarioComercio.findMany({
            where: targetSucursalId ? { id_comercio: targetSucursalId } : {},
            orderBy: { cantidad_actual: 'asc' },
            take: 3,
            include: { producto: { select: { nombre: true } } }
        });

        // 3. Datos del Gráfico (Ventas de los últimos 7 días con Gap-Filling)
        const hoy = new Date();
        const diasSemana = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
        const chartData = [];

        // Generamos los últimos 7 días como base
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(hoy.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            chartData.push({
                fullDate: dateStr,
                name: diasSemana[d.getDay()],
                ventas: 0
            });
        }

        const sieteDiasAtras = new Date();
        sieteDiasAtras.setDate(sieteDiasAtras.getDate() - 7);

        const ventasRecientes = await prisma.ventaCabecera.groupBy({
            by: ['fecha_hora'],
            where: {
                fecha_hora: { gte: sieteDiasAtras },
                ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
            },
            _sum: { total_venta: true }
        });

        // Mapeamos las ventas a los días generados
        ventasRecientes.forEach(v => {
            const vDateStr = v.fecha_hora.toISOString().split('T')[0];
            const dayEntry = chartData.find(d => d.fullDate === vDateStr);
            if (dayEntry) {
                dayEntry.ventas += Number(v._sum.total_venta || 0);
            }
        });

        // 4. Sucursales con mayor deuda (Solo para SuperAdmin) - INCLUYENDO ID para React Key
        let sucursalesDeuda = [];
        if (isSuperAdmin) {
            sucursalesDeuda = await prisma.comercio.findMany({
                where: { activo: true },
                orderBy: { saldo_acumulado_mili: 'desc' },
                take: 3,
                select: { 
                    id_comercio: true, // Vital para la key en React
                    nombre: true, 
                    saldo_acumulado_mili: true 
                }
            });
        }

        res.json({
            metrics: {
                totalCaja: targetSucursalId ? Number(totalCaja?.saldo_acumulado_mili || 0) : Number(totalCaja?._sum?.saldo_acumulado_mili || 0),
                productosCount,
                usuariosCount
            },
            stockCritico: stockCritico.map(s => ({
                nombre: s.producto.nombre,
                cantidad: s.cantidad_actual
            })),
            chartData, // Ahora siempre tiene 7 elementos con 'name' y 'ventas'
            sucursalesDeuda: sucursalesDeuda.map(s => ({
                id_comercio: s.id_comercio,
                nombre: s.nombre,
                saldo_acumulado_mili: Number(s.saldo_acumulado_mili)
            }))
        });

    } catch (error) {
        console.error('Error GET /dashboard/stats:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas del dashboard' });
    }
});

module.exports = router;
