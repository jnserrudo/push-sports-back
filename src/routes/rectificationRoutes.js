const express = require('express');
const router = express.Router();
const rectificationService = require('../services/rectificationService');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// ═══════════════════════════════════════════════════════════
// RECTIFICACIÓN DE VENTAS
// ═══════════════════════════════════════════════════════════

// Rectificar venta directamente (solo roles 1 y 2)
router.post('/ventas', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id_venta, nuevos_detalles, metodo_pago, motivo } = req.body;
        if (!id_venta || !motivo) return res.status(400).json({ error: 'Faltan id_venta y/o motivo.' });

        const resultado = await rectificationService.rectificarVenta({
            id_venta, nuevos_detalles, metodo_pago, motivo,
            id_usuario: req.user.id_usuario
        });

        res.status(201).json({ message: 'Venta rectificada correctamente', data: resultado });
    } catch (error) {
        console.error('Error rectificando venta:', error);
        res.status(400).json({ error: error.message });
    }
});

// Rectificar movimiento de stock directamente (solo roles 1 y 2)
router.post('/movimientos', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id_movimiento, nuevos_items, motivo } = req.body;
        if (!id_movimiento || !motivo) return res.status(400).json({ error: 'Faltan id_movimiento y/o motivo.' });

        const resultado = await rectificationService.rectificarMovimiento({
            id_movimiento, nuevos_items, motivo,
            id_usuario: req.user.id_usuario
        });

        res.status(201).json({ message: 'Movimiento rectificado correctamente', data: resultado });
    } catch (error) {
        console.error('Error rectificando movimiento:', error);
        res.status(400).json({ error: error.message });
    }
});

// ═══════════════════════════════════════════════════════════
// SOLICITUDES (FLUJO DE APROBACIÓN PARA VENDEDORES)
// ═══════════════════════════════════════════════════════════

// Crear solicitud (todos los roles, pero principalmente rol 3)
router.post('/solicitudes', authMiddleware, async (req, res) => {
    try {
        const { tipo_entidad, id_entidad, id_comercio, motivo, datos_corregidos } = req.body;
        if (!tipo_entidad || !id_entidad || !id_comercio || !motivo) {
            return res.status(400).json({ error: 'Faltan campos obligatorios.' });
        }

        const solicitud = await rectificationService.crearSolicitud({
            tipo_entidad, id_entidad, id_comercio,
            id_solicitante: req.user.id_usuario,
            motivo, datos_corregidos
        });

        res.status(201).json({ message: 'Solicitud creada', data: solicitud });
    } catch (error) {
        console.error('Error creando solicitud:', error);
        res.status(400).json({ error: error.message });
    }
});

// Obtener solicitudes pendientes (roles 1 y 2)
router.get('/solicitudes/pendientes', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        // Supervisor de sucursal solo ve las de su comercio
        const isGlobal = req.user.id_rol === 1 || (req.user.id_rol === 2 && !req.user.id_comercio_asignado);
        const id_comercio = isGlobal ? null : req.user.id_comercio_asignado;

        const pendientes = await rectificationService.getPendientes(id_comercio);
        res.json(pendientes);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo solicitudes pendientes' });
    }
});

// Historial de solicitudes
router.get('/solicitudes/historial', authMiddleware, async (req, res) => {
    try {
        const isGlobal = req.user.id_rol === 1 || (req.user.id_rol === 2 && !req.user.id_comercio_asignado);
        const id_comercio = isGlobal ? null : req.user.id_comercio_asignado;

        const historial = await rectificationService.getHistorial(id_comercio);
        res.json(historial);
    } catch (error) {
        res.status(500).json({ error: 'Error obteniendo historial' });
    }
});

// Aprobar solicitud (roles 1 y 2)
router.post('/solicitudes/:id/aprobar', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const resultado = await rectificationService.aprobarSolicitud({
            id_solicitud: req.params.id,
            id_aprobador: req.user.id_usuario
        });
        res.json({ message: 'Solicitud aprobada y rectificación ejecutada', data: resultado });
    } catch (error) {
        console.error('Error aprobando solicitud:', error);
        res.status(400).json({ error: error.message });
    }
});

// Rechazar solicitud (roles 1 y 2)
router.post('/solicitudes/:id/rechazar', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { motivo_rechazo } = req.body;
        const resultado = await rectificationService.rechazarSolicitud({
            id_solicitud: req.params.id,
            id_aprobador: req.user.id_usuario,
            motivo_rechazo
        });
        res.json({ message: 'Solicitud rechazada', data: resultado });
    } catch (error) {
        console.error('Error rechazando solicitud:', error);
        res.status(400).json({ error: error.message });
    }
});

module.exports = router;
