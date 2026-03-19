const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Listar comercios PÚBLICO (Para la Landing Page)
router.get('/public', async (req, res) => {
    try {
        const comercios = await prisma.comercio.findMany({
            where: { activo: true },
            include: { tipo_comercio: true }
        });
        res.json(comercios);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener comercios públicos' });
    }
});

// Listar comercios (Para el Dashboard, con auth)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const comercios = await prisma.comercio.findMany({
            where: canSeeInactive ? {} : { activo: true },
            include: { tipo_comercio: true }
        });
        res.json(comercios);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener comercios' });
    }
});

// Crear comercio (Solo SUPER_ADMIN)
router.post('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { tipo_comercio, ...validData } = req.body;
        const comercio = await prisma.comercio.create({ data: validData });
        res.status(201).json(comercio);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear comercio' });
    }
});

// Actualizar comercio (SUPER_ADMIN o Supervisor de ESE comercio)
router.put('/:id', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id } = req.params;
        const { tipo_comercio, ...validData } = req.body;

        if (req.user.id_rol === 2 && req.user.id_comercio_asignado !== id) {
            return res.status(403).json({ error: 'Solo puedes editar tu propio comercio' });
        }

        const comercio = await prisma.comercio.update({
            where: { id_comercio: id },
            data: validData
        });
        res.json(comercio);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar comercio' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.comercio.update({
            where: { id_comercio: id },
            data: { activo: false }
        });
        res.json({ message: 'Comercio desactivado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar comercio' });
    }
});

module.exports = router;
