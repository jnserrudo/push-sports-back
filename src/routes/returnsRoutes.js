const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const inventoryService = require('../services/inventoryService');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/devoluciones
// Procesa la devolución parcial o total de un ítem de una venta existente.
// 
// Flujo de Inventario:
//   1. Valida que la venta existe y que el ítem vendido tiene suficientes unidades
//      para devolver la cantidad solicitada.
//   2. Registra el evento en la tabla DEVOLUCIONES.
//   3. Ingresa el stock de vuelta al INVENTARIO_COMERCIO (suma la cantidad).
//   4. Crea un movimiento en el Kardex (MOVIMIENTOS_STOCK) de tipo 5 = 
//      "Devolución Cliente (Ingreso)" con factor_multiplicador +1.
//
// NOTA: La devolución NO modifica el campo `saldo_acumulado_mili` de COMERCIOS
// porque ese campo es gestionado exclusivamente por el módulo de Liquidaciones.
// El control financiero de devoluciones queda registrado en DEVOLUCIONES para
// que el administrador lo tome en cuenta al hacer la liquidación.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, roleMiddleware([1, 2, 3]), async (req, res) => {
    try {
        const { id_venta, id_producto, cantidad, motivo } = req.body;
        const id_usuario = req.user.id_usuario;

        // ── 1. Validaciones de entrada ─────────────────────────────────────
        if (!id_venta || !id_producto || !cantidad || parseInt(cantidad) <= 0) {
            return res.status(400).json({
                error: 'Datos inválidos. Se requiere id_venta, id_producto y una cantidad mayor a 0.'
            });
        }

        const cantidadInt = parseInt(cantidad);

        // ── 2. Verificar que la venta y el ítem existen ─────────────────────
        const venta = await prisma.ventaCabecera.findUnique({
            where: { id_venta },
            include: {
                detalles: { include: { producto: true } }
            }
        });

        if (!venta) {
            return res.status(404).json({ error: 'Venta no encontrada.' });
        }

        // Roles 2 y 3 solo pueden operar en su propio comercio
        if (req.user.id_rol !== 1 && req.user.id_comercio_asignado !== venta.id_comercio) {
            return res.status(403).json({
                error: 'No tienes permiso para gestionar devoluciones de este comercio.'
            });
        }

        // Verificar que el ítem pertenece a esa venta
        const detalle = venta.detalles.find(d => d.id_producto === id_producto);
        if (!detalle) {
            return res.status(404).json({
                error: 'El producto indicado no fue vendido en ese ticket.'
            });
        }

        // ── 3. Validar contra devoluciones previas del mismo ítem ──────────
        // Sumar todas las devoluciones anteriores del mismo (id_venta, id_producto)
        const devolucionesPrevias = await prisma.devolucion.aggregate({
            where: { id_venta, id_producto },
            _sum: { cantidad: true }
        });
        const yaDevuelto = devolucionesPrevias._sum.cantidad || 0;
        const disponibleParaDevolver = detalle.cantidad - yaDevuelto;

        if (cantidadInt > disponibleParaDevolver) {
            return res.status(400).json({
                error: `Solo se pueden devolver ${disponibleParaDevolver} unidad(es) más de ese producto (ya se devolvieron ${yaDevuelto} de ${detalle.cantidad}).`
            });
        }

        const montoReembolso = parseFloat(detalle.precio_unitario_cobrado) * cantidadInt;
        const id_comercio = venta.id_comercio;

        // ── 4. Transacción atómica ─────────────────────────────────────────
        const resultado = await prisma.$transaction(async (tx) => {

            // 4a. Registrar en DEVOLUCIONES
            const devolucion = await tx.devolucion.create({
                data: {
                    id_venta,
                    id_producto,
                    cantidad: cantidadInt,
                    monto_reembolso: montoReembolso,
                    motivo: motivo?.trim() || null,
                    id_usuario,
                    id_comercio
                }
            });

            // 4b. Re-ingresar stock al Kardex
            //     tipo_movimiento: 5 = "Devolución Cliente (Ingreso)", factor +1
            await inventoryService.updateStock({
                id_comercio,
                id_producto,
                id_usuario,
                id_tipo_movimiento: 5,  // Devolución Cliente (Ingreso)
                cantidad_cambio: cantidadInt
            }, tx);

            return devolucion;
        });

        res.status(201).json({
            message: `Devolución procesada: ${cantidadInt} unidad(es) de "${detalle.producto?.nombre}" re-ingresadas al inventario.`,
            devolucion: resultado,
            monto_reembolso: montoReembolso
        });

    } catch (error) {
        console.error('Error procesando devolución:', error);
        res.status(500).json({ error: error.message || 'Error interno al procesar la devolución.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/devoluciones/comercio/:id_comercio
// Historial de devoluciones de un comercio. Visible para roles 1, 2, 3.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/comercio/:id_comercio', authMiddleware, async (req, res) => {
    try {
        const { id_comercio } = req.params;

        if (req.user.id_rol !== 1 && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'Acceso denegado.' });
        }

        const devoluciones = await prisma.devolucion.findMany({
            where: { id_comercio },
            include: {
                producto: { select: { nombre: true, imagen_url: true } },
                usuario: { select: { nombre: true, apellido: true } },
                venta: { select: { fecha_hora: true, metodo_pago: true, total_venta: true } }
            },
            orderBy: { fecha: 'desc' }
        });

        res.json(devoluciones);
    } catch (error) {
        console.error('Error obteniendo historial de devoluciones:', error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/devoluciones
// Global: solo SuperAdmin. Lista todas las devoluciones del sistema.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const devoluciones = await prisma.devolucion.findMany({
            include: {
                producto: { select: { nombre: true } },
                usuario: { select: { nombre: true, apellido: true } },
                comercio: { select: { nombre: true } },
                venta: { select: { fecha_hora: true, total_venta: true } }
            },
            orderBy: { fecha: 'desc' }
        });
        res.json(devoluciones);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error interno.' });
    }
});

module.exports = router;
