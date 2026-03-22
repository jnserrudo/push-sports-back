const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

const { authMiddleware } = require('../middlewares/authMiddleware');
const { notifyCommerceManagers } = require('../services/notificationService');

// Listar todos los movimientos de stock
router.get('/', authMiddleware, async (req, res) => {
    try {
        // Roles 2 y 3 solo pueden ver movimientos de su propio comercio
        const filter = (req.user.id_rol === 2 || req.user.id_rol === 3)
            ? { id_comercio: req.user.id_comercio_asignado }
            : {};

        const movimientos = await prisma.movimientoStock.findMany({
            where: filter,
            include: {
                producto: true,
                comercio: true,
                usuario: true,
                tipo_movimiento: true
            },
            orderBy: { fecha_hora: 'desc' }
        });
        res.json(movimientos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener movimientos de stock' });
    }
});

// Movimientos de un comercio específico
router.get('/comercio/:id_comercio', authMiddleware, async (req, res) => {
    try {
        const { id_comercio } = req.params;
        const movimientos = await prisma.movimientoStock.findMany({
            where: { id_comercio },
            include: {
                producto: true,
                usuario: true,
                tipo_movimiento: true
            },
            orderBy: { fecha_hora: 'desc' }
        });
        res.json(movimientos);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener movimientos del comercio' });
    }
});

// Crear movimiento de stock (Ingreso, Egreso, Ajuste)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { id_comercio, id_producto, cantidad_cambio, id_tipo_movimiento } = req.body;
        const id_usuario = req.user.id_usuario;

        // 1. Obtener o crear inventario
        let inventario = await prisma.inventarioComercio.findUnique({
            where: { id_comercio_id_producto: { id_comercio, id_producto } }
        });

        if (!inventario) {
            inventario = await prisma.inventarioComercio.create({
                data: { id_comercio, id_producto, cantidad_actual: 0 }
            });
        }

        const saldo_anterior = inventario.cantidad_actual;
        const saldo_posterior = saldo_anterior + parseInt(cantidad_cambio);

        // 2. Realizar operación en transacción
        const result = await prisma.$transaction(async (tx) => {
            // Actualizar stock
            const updatedInv = await tx.inventarioComercio.update({
                where: { id_inventario: inventario.id_inventario },
                data: { cantidad_actual: saldo_posterior }
            });

            // Registrar movimiento
            const mov = await tx.movimientoStock.create({
                data: {
                    id_comercio,
                    id_producto,
                    id_usuario,
                    id_tipo_movimiento: parseInt(id_tipo_movimiento),
                    cantidad_cambio: parseInt(cantidad_cambio),
                    saldo_anterior,
                    saldo_posterior
                },
                include: { producto: true, comercio: true, tipo_movimiento: true }
            });

            return mov;
        });

        // 3. Notificar a managers
        await notifyCommerceManagers(id_comercio, {
            titulo: 'Actualización de Stock',
            mensaje: `Movimiento de ${cantidad_cambio} unidades registrado para "${result.producto.nombre}" (${result.tipo_movimiento.nombre_movimiento}).`,
            tipo: 'COMMERCE'
        });

        // Si es un ingreso (tipo 1), validar y descontar del stock_central del producto
        if (parseInt(id_tipo_movimiento) === 1) {
            const producto = await prisma.producto.findUnique({
                where: { id_producto },
                select: { stock_central: true, nombre: true }
            });

            const cantidadEnvio = Math.abs(parseInt(cantidad_cambio));
            
            if (!producto || producto.stock_central < cantidadEnvio) {
                return res.status(400).json({ 
                    error: `Stock central insuficiente para "${producto?.nombre || 'producto'}". Disponible: ${producto?.stock_central || 0}, Requerido: ${cantidadEnvio}` 
                });
            }

            await prisma.producto.update({
                where: { id_producto },
                data: {
                    stock_central: {
                        decrement: cantidadEnvio
                    }
                }
            });
        }

        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al registrar movimiento de stock' });
    }
});

module.exports = router;
