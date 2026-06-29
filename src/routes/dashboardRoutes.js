const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { Prisma } = require('@prisma/client');
const { authMiddleware } = require('../middlewares/authMiddleware');

router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const { sucursalId } = req.query;
        const isSuperAdmin = req.user.id_rol === 1;
        const isGlobalSupervisor = req.user.id_rol === 2 && !req.user.id_comercio_asignado;

        // Si es Admin de Sucursal y no es global, forzamos sucursalId
        // Si sucursalId es 'ALL', lo tratamos como null para traer datos globales
        const targetSucursalId = ((isSuperAdmin || isGlobalSupervisor) && sucursalId !== 'ALL') ? sucursalId : ((isSuperAdmin || isGlobalSupervisor) ? null : req.user.id_comercio_asignado);

        // 1. Métricas Principales (Counts & Sums)
        const [totalCaja, productosCount, usuariosCount] = await Promise.all([
            // Saldo acumulado
            targetSucursalId && targetSucursalId !== 'ALL'
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
                estado: { in: ['ACTIVA', 'LIQUIDADA'] },
                tipo_venta: 'VENTA',
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

        // 4. Sucursales con mayor deuda (Solo para SuperAdmin o Global Supervisor) - INCLUYENDO ID para React Key
        let sucursalesDeuda = [];
        if (isSuperAdmin || isGlobalSupervisor) {
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

        // 5. Total de Ventas del Período (últimos 30 días)
        const treintaDiasAtras = new Date();
        treintaDiasAtras.setDate(treintaDiasAtras.getDate() - 30);

        const ventasPeriodoActual = await prisma.ventaCabecera.aggregate({
            where: {
                fecha_hora: { gte: treintaDiasAtras },
                estado: { in: ['ACTIVA', 'LIQUIDADA'] },
                tipo_venta: 'VENTA',
                ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
            },
            _sum: { total_venta: true },
            _count: true
        });

        // Período anterior (30 días antes) para comparación
        const sesentaDiasAtras = new Date();
        sesentaDiasAtras.setDate(sesentaDiasAtras.getDate() - 60);

        const ventasPeriodoAnterior = await prisma.ventaCabecera.aggregate({
            where: {
                fecha_hora: { gte: sesentaDiasAtras, lt: treintaDiasAtras },
                estado: { in: ['ACTIVA', 'LIQUIDADA'] },
                tipo_venta: 'VENTA',
                ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
            },
            _sum: { total_venta: true }
        });

        const totalVentasActual = Number(ventasPeriodoActual._sum.total_venta || 0);
        const totalVentasAnterior = Number(ventasPeriodoAnterior._sum.total_venta || 0);
        const crecimientoVentas = totalVentasAnterior > 0 
            ? Math.round(((totalVentasActual - totalVentasAnterior) / totalVentasAnterior) * 100)
            : 0;

        // 5b. Total de Liquidaciones (Ingresos ya cobrados)
        const liquidacionesTotales = await prisma.liquidacion.aggregate({
            where: {
                fecha_cierre: { gte: treintaDiasAtras },
                ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
            },
            _sum: { monto_recibido: true },
            _count: true
        });

        const totalIngresos = Number(liquidacionesTotales._sum.monto_recibido || 0);

        console.log('📊 Dashboard Stats:', {
            totalVentasActual,
            cantidadVentas: ventasPeriodoActual._count,
            crecimientoVentas,
            totalCaja: targetSucursalId ? totalCaja?.saldo_acumulado_mili : totalCaja?._sum?.saldo_acumulado_mili,
            totalIngresos,
            cantidadLiquidaciones: liquidacionesTotales._count
        });

        // 6. Productos Más Vendidos (Top 5) - Optimizado con SQL raw
        const productosTopRaw = targetSucursalId 
            ? await prisma.$queryRaw`
                SELECT 
                    vd.id_producto,
                    p.nombre,
                    SUM(vd.cantidad) as cantidad,
                    SUM(vd.cantidad * vd.precio_unitario_cobrado) as total
                FROM "VENTAS_DETALLE" vd
                INNER JOIN "VENTAS_CABECERA" vc ON vd.id_venta = vc.id_venta
                INNER JOIN "PRODUCTOS" p ON vd.id_producto = p.id_producto
                WHERE vc.fecha_hora >= ${treintaDiasAtras}
                    AND vc.estado IN ('ACTIVA', 'LIQUIDADA')
                    AND vc.tipo_venta = 'VENTA'
                    AND vc.id_comercio = ${targetSucursalId}
                GROUP BY vd.id_producto, p.nombre
                ORDER BY cantidad DESC
                LIMIT 5
            `
            : await prisma.$queryRaw`
                SELECT 
                    vd.id_producto,
                    p.nombre,
                    SUM(vd.cantidad) as cantidad,
                    SUM(vd.cantidad * vd.precio_unitario_cobrado) as total
                FROM "VENTAS_DETALLE" vd
                INNER JOIN "VENTAS_CABECERA" vc ON vd.id_venta = vc.id_venta
                INNER JOIN "PRODUCTOS" p ON vd.id_producto = p.id_producto
                WHERE vc.fecha_hora >= ${treintaDiasAtras}
                    AND vc.estado IN ('ACTIVA', 'LIQUIDADA')
                    AND vc.tipo_venta = 'VENTA'
                GROUP BY vd.id_producto, p.nombre
                ORDER BY cantidad DESC
                LIMIT 5
            `;

        const productosTopConNombres = productosTopRaw.map(p => ({
            nombre: p.nombre,
            cantidad: Number(p.cantidad),
            total: Number(p.total || 0)
        }));

        console.log('🏆 Productos Top:', productosTopConNombres.length, productosTopConNombres);

        // 7. Ventas por Método de Pago
        const ventasPorMetodo = await prisma.ventaCabecera.groupBy({
            by: ['metodo_pago'],
            where: {
                fecha_hora: { gte: treintaDiasAtras },
                estado: { in: ['ACTIVA', 'LIQUIDADA'] },
                tipo_venta: 'VENTA',
                ...(targetSucursalId ? { id_comercio: targetSucursalId } : {})
            },
            _sum: { total_venta: true },
            _count: true
        });

        const metodosPago = ventasPorMetodo.map(v => ({
            metodo: v.metodo_pago,
            total: Number(v._sum.total_venta || 0),
            cantidad: v._count
        }));

        console.log('💳 Métodos de Pago:', metodosPago.length, metodosPago);

        // 8. Rendimiento por Sucursal (Solo para SuperAdmin) - Optimizado
        let rendimientoSucursales = [];
        if (isSuperAdmin || isGlobalSupervisor) {
            const sucursalesRaw = await prisma.$queryRaw`
                SELECT 
                    vc.id_comercio,
                    c.nombre,
                    SUM(vc.total_venta) as total,
                    COUNT(*) as cantidad
                FROM "VENTAS_CABECERA" vc
                INNER JOIN "COMERCIOS" c ON vc.id_comercio = c.id_comercio
                WHERE vc.fecha_hora >= ${treintaDiasAtras}
                    AND vc.estado IN ('ACTIVA', 'LIQUIDADA')
                    AND vc.tipo_venta = 'VENTA'
                GROUP BY vc.id_comercio, c.nombre
                ORDER BY total DESC
                LIMIT 5
            `;

            rendimientoSucursales = sucursalesRaw.map(s => ({
                id_comercio: s.id_comercio,
                nombre: s.nombre,
                total: Number(s.total || 0),
                cantidad: Number(s.cantidad)
            }));
        }

        res.json({
            metrics: {
                totalCaja: targetSucursalId ? Number(totalCaja?.saldo_acumulado_mili || 0) : Number(totalCaja?._sum?.saldo_acumulado_mili || 0),
                productosCount,
                usuariosCount,
                totalVentas: totalVentasActual,
                cantidadVentas: ventasPeriodoActual._count,
                crecimientoVentas: crecimientoVentas,
                totalIngresos: totalIngresos,
                cantidadLiquidaciones: liquidacionesTotales._count
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
            })),
            productosTop: productosTopConNombres,
            metodosPago: metodosPago,
            rendimientoSucursales: rendimientoSucursales
        });

    } catch (error) {
        console.error('Error GET /dashboard/stats:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas del dashboard' });
    }
});

module.exports = router;
