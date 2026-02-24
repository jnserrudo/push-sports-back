const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// Listar todos los movimientos de stock
router.get('/', async (req, res) => {
    try {
        const movimientos = await prisma.movimientoStock.findMany({
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
router.get('/comercio/:id_comercio', async (req, res) => {
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

module.exports = router;
