const express = require('express');
const router = express.Router();
const liquidationService = require('../services/liquidationService');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Generar una liquidación para un comercio (ADMIN o Supervisor de ESE comercio)
router.post('/', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id_comercio, observacion } = req.body;

        if (!id_comercio) {
            return res.status(400).json({ error: 'Falta id_comercio' });
        }

        // Supervisor solo puede liquidar su comercio
        if (req.user.id_rol === 2 && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'Solo puedes generar liquidaciones de tu propio comercio' });
        }

        const liquidacion = await liquidationService.generateLiquidation({
            id_comercio,
            observacion
        });

        res.status(201).json({ message: 'Liquidación generada', data: liquidacion });
    } catch (error) {
        console.error('Error al generar liquidación:', error);
        res.status(500).json({ error: error.message || 'Error interno' });
    }
});

// Obtener historial de liquidaciones
router.get('/:id_comercio', authMiddleware, roleMiddleware([1, 2, 3]), async (req, res) => {
    try {
        const { id_comercio } = req.params;

        // Seguridad: Supervisor/Vendedor solo ven su comercio
        if (req.user.id_rol !== 1 && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para ver liquidaciones de otro comercio' });
        }

        const liquidaciones = await liquidationService.getLiquidations(id_comercio);
        res.json(liquidaciones);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching liquidations' });
    }
});

module.exports = router;
