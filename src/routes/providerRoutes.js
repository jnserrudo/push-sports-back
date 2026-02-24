const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Listar proveedores
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const proveedores = await prisma.proveedor.findMany({
            where: canSeeInactive ? {} : { activo: true }
        });
        res.json(proveedores);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener proveedores' });
    }
});

// Crear proveedor (Roles 1 y 2)
router.post('/', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const data = req.body;
        const proveedor = await prisma.proveedor.create({ data });
        res.status(201).json(proveedor);
    } catch (error) {
        res.status(500).json({ error: 'Error al crear proveedor' });
    }
});

// Actualizar proveedor (Roles 1 y 2)
router.put('/:id', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        const proveedor = await prisma.proveedor.update({
            where: { id_proveedor: id },
            data
        });
        res.json(proveedor);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar proveedor' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.proveedor.update({
            where: { id_proveedor: id },
            data: { activo: false }
        });
        res.json({ message: 'Proveedor desactivado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar proveedor' });
    }
});

module.exports = router;
