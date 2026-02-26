const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Listar ofertas
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const ofertas = await prisma.oferta.findMany({
            where: canSeeInactive ? {} : { activo: true },
            orderBy: { fecha_creacion: 'desc' }
        });
        res.json(ofertas);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener ofertas' });
    }
});

// Crear oferta (Solo SUPER_ADMIN)
router.post('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { nombre, descuento_porcentaje, fecha_inicio, fecha_fin } = req.body;

        if (!nombre || !descuento_porcentaje || !fecha_inicio) {
            return res.status(400).json({ error: 'Nombre, porcentaje y fecha inicio son obligatorios' });
        }

        const oferta = await prisma.oferta.create({
            data: {
                nombre,
                descuento_porcentaje: parseFloat(descuento_porcentaje),
                fecha_inicio: new Date(fecha_inicio),
                fecha_fin: fecha_fin ? new Date(fecha_fin) : null
            }
        });
        res.status(201).json(oferta);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al crear oferta' });
    }
});

// Actualizar oferta (Solo SUPER_ADMIN)
router.put('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = { ...req.body };

        if (data.descuento_porcentaje) data.descuento_porcentaje = parseFloat(data.descuento_porcentaje);
        if (data.fecha_inicio) data.fecha_inicio = new Date(data.fecha_inicio);
        if (data.fecha_fin) data.fecha_fin = new Date(data.fecha_fin);

        const oferta = await prisma.oferta.update({
            where: { id_oferta: id },
            data
        });
        res.json(oferta);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar oferta' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.oferta.update({
            where: { id_oferta: id },
            data: { activo: false }
        });
        res.json({ message: 'Oferta desactivada correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar oferta' });
    }
});

module.exports = router;
