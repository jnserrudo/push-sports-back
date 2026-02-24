const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Obtener todos los productos
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const productos = await prisma.producto.findMany({
            where: canSeeInactive ? {} : { activo: true },
            include: { marca: true, categoria: true, proveedor: true }
        });
        res.json(productos);
    } catch (error) {
         res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// Crear un producto (Solo SUPER_ADMIN/SUPERVISOR)
router.post('/', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const data = req.body;
        const producto = await prisma.producto.create({ data });
        res.status(201).json(producto);
    } catch (error) {
         res.status(500).json({ error: 'Error al crear producto' });
    }
});

// Actualizar un producto (Solo SUPER_ADMIN/SUPERVISOR)
router.put('/:id', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;
        
        const producto = await prisma.producto.update({
            where: { id_producto: id },
            data
        });

        res.json(producto);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.producto.update({
            where: { id_producto: id },
            data: { activo: false }
        });
        res.json({ message: 'Producto desactivado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al desactivar producto' });
    }
});

module.exports = router;
