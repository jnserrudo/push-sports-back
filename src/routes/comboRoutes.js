const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Listar combos
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const combos = await prisma.combo.findMany({
            where: canSeeInactive ? {} : { activo: true },
            orderBy: { fecha_creacion: 'desc' }
        });
        res.json(combos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener combos' });
    }
});

// Crear combo (Solo SUPER_ADMIN)
router.post('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { nombre, descripcion, precio_combo } = req.body;

        if (!nombre || !precio_combo) {
            return res.status(400).json({ error: 'Nombre y precio son obligatorios' });
        }

        const combo = await prisma.combo.create({
            data: {
                nombre,
                descripcion: descripcion || null,
                precio_combo: parseFloat(precio_combo)
            }
        });
        res.status(201).json(combo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear combo' });
    }
});

// Actualizar combo (Solo SUPER_ADMIN)
router.put('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = { ...req.body };

        if (data.precio_combo) data.precio_combo = parseFloat(data.precio_combo);

        const combo = await prisma.combo.update({
            where: { id_combo: id },
            data
        });
        res.json(combo);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar combo' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.combo.update({
            where: { id_combo: id },
            data: { activo: false }
        });
        res.json({ message: 'Combo desactivado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar combo' });
    }
});

module.exports = router;
