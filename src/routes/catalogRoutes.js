const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

// --- CATEGORIAS ---
router.get('/categorias', async (req, res) => {
    res.json(await prisma.categoria.findMany());
});
router.post('/categorias', roleMiddleware([1]), async (req, res) => {
    res.json(await prisma.categoria.create({ data: req.body }));
});
router.put('/categorias/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    res.json(await prisma.categoria.update({ where: { id_categoria: parseInt(id) }, data: req.body }));
});
router.delete('/categorias/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    await prisma.categoria.delete({ where: { id_categoria: parseInt(id) } });
    res.json({ message: 'Categoría eliminada' });
});

// --- MARCAS ---
router.get('/marcas', async (req, res) => {
    res.json(await prisma.marca.findMany());
});
router.post('/marcas', roleMiddleware([1]), async (req, res) => {
    res.json(await prisma.marca.create({ data: req.body }));
});
router.put('/marcas/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    res.json(await prisma.marca.update({ where: { id_marca: parseInt(id) }, data: req.body }));
});
router.delete('/marcas/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    await prisma.marca.delete({ where: { id_marca: parseInt(id) } });
    res.json({ message: 'Marca eliminada' });
});

// --- TIPOS COMERCIO ---
router.get('/tipos-comercio', async (req, res) => {
    res.json(await prisma.tipoComercio.findMany());
});
router.post('/tipos-comercio', roleMiddleware([1]), async (req, res) => {
    res.json(await prisma.tipoComercio.create({ data: req.body }));
});
router.put('/tipos-comercio/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    res.json(await prisma.tipoComercio.update({ where: { id_tipo_comercio: parseInt(id) }, data: req.body }));
});
router.delete('/tipos-comercio/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    await prisma.tipoComercio.delete({ where: { id_tipo_comercio: parseInt(id) } });
    res.json({ message: 'Tipo de comercio eliminado' });
});

// --- TIPOS MOVIMIENTO ---
router.get('/tipos-movimiento', async (req, res) => {
    res.json(await prisma.tipoMovimiento.findMany());
});
router.post('/tipos-movimiento', roleMiddleware([1]), async (req, res) => {
    res.json(await prisma.tipoMovimiento.create({ data: req.body }));
});
router.put('/tipos-movimiento/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    res.json(await prisma.tipoMovimiento.update({ where: { id_tipo_movimiento: parseInt(id) }, data: req.body }));
});
router.delete('/tipos-movimiento/:id', roleMiddleware([1]), async (req, res) => {
    const { id } = req.params;
    await prisma.tipoMovimiento.delete({ where: { id_tipo_movimiento: parseInt(id) } });
    res.json({ message: 'Tipo de movimiento eliminado' });
});

module.exports = router;
