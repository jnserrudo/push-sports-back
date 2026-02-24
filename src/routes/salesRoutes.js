const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const inventoryService = require('../services/inventoryService');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Endpoint para registrar una venta con múltiples productos
router.post('/', authMiddleware, roleMiddleware([1, 2, 3]), async (req, res) => {
    try {
        const { id_comercio, detalles, metodo_pago } = req.body;
        const id_usuario = req.user.id_usuario; // Usar ID del token

        // 1. Validar que el usuario tenga permiso para vender en este comercio
        // Role 1 (SuperAdmin) puede vender en cualquiera. Roles 2 y 3 solo en el suyo.
        if (req.user.id_rol !== 1 && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para registrar ventas en este comercio.' });
        }

        if (!id_comercio || !metodo_pago || !Array.isArray(detalles) || detalles.length === 0) {
            return res.status(400).json({ error: 'Faltan datos requeridos o detalles inválidos.' });
        }

        // Variable para acumular el total de la cabecera
        let total_venta_cabecera = 0;
        
        // 2. Pre-validar stock de todos los productos y preparar cálculos
        const detallesProcesados = [];

        for (const item of detalles) {
             const { id_producto, cantidad, precio_unitario } = item;

             if (!id_producto || cantidad <= 0 || !precio_unitario) {
                  return res.status(400).json({ error: 'Detalle de formato inválido.' });
             }

             const inventario = await prisma.inventarioComercio.findUnique({
                  where: { id_comercio_id_producto: { id_comercio, id_producto } },
                  include: { producto: true }
             });

             if (!inventario || !inventario.producto.activo) {
                  return res.status(404).json({ error: `Producto ${id_producto} no disponible en este comercio.` });
             }

             if (inventario.cantidad_actual < cantidad) {
                 return res.status(400).json({ error: `Stock insuficiente para el producto ${inventario.producto.nombre}.` });
             }

             const subtotal = parseFloat(precio_unitario) * cantidad;
             const comision_porcentaje = parseFloat(inventario.comision_pactada_porcentaje) || 0;
             const comision_monto = (subtotal * comision_porcentaje) / 100;
             const neto = subtotal - comision_monto;
             const costo_unitario_historico = inventario.producto.costo_compra;

             total_venta_cabecera += subtotal;

             detallesProcesados.push({
                 id_producto,
                 cantidad,
                 precio_unitario_cobrado: precio_unitario,
                 costo_unitario_historico,
                 subtotal,
                 comision_monto_historico: comision_monto,
                 neto_mili_historico: neto
             });
        }

        // 3. Iniciar transacción principal para cabecera, detalles y stock
        const result = await prisma.$transaction(async (tx) => {
             // 3a. Crear Cabecera
             const nuevaVenta = await tx.ventaCabecera.create({
                 data: {
                     id_comercio,
                     id_usuario,
                     total_venta: total_venta_cabecera,
                     metodo_pago
                 }
             });

             // 3b. Insertar Detalles
             const detailsWithVentaId = detallesProcesados.map(d => ({
                 ...d,
                 id_venta: nuevaVenta.id_venta
             }));

             await tx.ventaDetalle.createMany({
                 data: detailsWithVentaId
             });

             // 3c. Actualizar Stock y registrar Movimientos (Kardex)
             for (const det of detallesProcesados) {
                 await inventoryService.updateStock({
                     id_comercio,
                     id_producto: det.id_producto,
                     id_usuario,
                     id_tipo_movimiento: 2, 
                     cantidad_cambio: -det.cantidad
                 }, tx);
             }

             return { ventaCabecera: nuevaVenta, detallesCount: detallesProcesados.length };
        });

        res.status(201).json({ message: 'Venta registrada con éxito', data: result });

    } catch (error) {
        console.error('Error al registrar venta:', error);
        res.status(500).json({ error: error.message || 'Error interno al registrar la venta.' });
    }
});

// Historial de ventas
router.get('/', authMiddleware, async (req, res) => {
    try {
        // SUPER_ADMIN (1) ve todo. Supervisor (2) y Vendedor (3) solo su comercio.
        const filter = (req.user.id_rol === 1) ? {} : { id_comercio: req.user.id_comercio_asignado };

        const ventas = await prisma.ventaCabecera.findMany({
            where: filter,
            include: { 
                 comercio: true,
                 usuario: true,
                 detalles: {
                      include: { producto: true }
                 }
            },
            orderBy: { fecha_hora: 'desc' }
        });
        res.json(ventas);
    } catch(err) {
        console.error(err);
        res.status(500).json({error: "Error fetching sales"});
    }
});

module.exports = router;
