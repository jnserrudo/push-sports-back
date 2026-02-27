const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

// --- CATEGORIAS ---
router.get('/categorias', async (req, res) => {
    try {
        res.json(await prisma.categoria.findMany());
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener categorias' });
    }
});
router.post('/categorias', roleMiddleware([1]), async (req, res) => {
    try {
        res.json(await prisma.categoria.create({ data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al crear categoria' });
    }
});
router.put('/categorias/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        res.json(await prisma.categoria.update({ where: { id_categoria: parseInt(id) }, data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar categoria' });
    }
});
router.delete('/categorias/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.categoria.delete({ where: { id_categoria: parseInt(id) } });
        res.json({ message: 'Categoría eliminada' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar categoria' });
    }
});

// --- MARCAS ---
router.get('/marcas', async (req, res) => {
    try {
        res.json(await prisma.marca.findMany());
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener marcas' });
    }
});
router.post('/marcas', roleMiddleware([1]), async (req, res) => {
    try {
        res.json(await prisma.marca.create({ data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al crear marca' });
    }
});
router.put('/marcas/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        res.json(await prisma.marca.update({ where: { id_marca: parseInt(id) }, data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar marca' });
    }
});
router.delete('/marcas/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.marca.delete({ where: { id_marca: parseInt(id) } });
        res.json({ message: 'Marca eliminada' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar marca' });
    }
});

// --- TIPOS COMERCIO ---
router.get('/tipos-comercio', async (req, res) => {
    try {
        res.json(await prisma.tipoComercio.findMany());
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener tipos de comercio' });
    }
});
router.post('/tipos-comercio', roleMiddleware([1]), async (req, res) => {
    try {
        res.json(await prisma.tipoComercio.create({ data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al crear tipo de comercio' });
    }
});
router.put('/tipos-comercio/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        res.json(await prisma.tipoComercio.update({ where: { id_tipo_comercio: parseInt(id) }, data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar tipo de comercio' });
    }
});
router.delete('/tipos-comercio/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.tipoComercio.delete({ where: { id_tipo_comercio: parseInt(id) } });
        res.json({ message: 'Tipo de comercio eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar tipo de comercio' });
    }
});

// --- TIPOS MOVIMIENTO ---
router.get('/tipos-movimiento', async (req, res) => {
    try {
        res.json(await prisma.tipoMovimiento.findMany());
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener tipos de movimiento' });
    }
});
router.post('/tipos-movimiento', roleMiddleware([1]), async (req, res) => {
    try {
        res.json(await prisma.tipoMovimiento.create({ data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al crear tipo de movimiento' });
    }
});
router.put('/tipos-movimiento/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        res.json(await prisma.tipoMovimiento.update({ where: { id_tipo_movimiento: parseInt(id) }, data: req.body }));
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar tipo de movimiento' });
    }
});
router.delete('/tipos-movimiento/:id', roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.tipoMovimiento.delete({ where: { id_tipo_movimiento: parseInt(id) } });
        res.json({ message: 'Tipo de movimiento eliminado' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar tipo de movimiento' });
    }
});

module.exports = router;
