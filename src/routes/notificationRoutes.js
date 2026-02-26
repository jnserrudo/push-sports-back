const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

// Listar todas las notificaciones (global)
router.get('/', async (req, res) => {
    try {
        const notificaciones = await prisma.notificacion.findMany({
            include: { usuario: true },
            orderBy: { fecha_envio: 'desc' }
        });
        res.json(notificaciones);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener notificaciones' });
    }
});

// Notificaciones de un usuario específico
router.get('/usuario/:id_usuario', async (req, res) => {
    try {
        const { id_usuario } = req.params;
        const notificaciones = await prisma.notificacion.findMany({
            where: { id_usuario },
            orderBy: { fecha_envio: 'desc' }
        });
        res.json(notificaciones);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener notificaciones del usuario' });
    }
});

// Marcar una como leída
router.put('/:id/leido', async (req, res) => {
    try {
        const { id } = req.params;
        const notificacion = await prisma.notificacion.update({
            where: { id_notificacion: id },
            data: { leido: true }
        });
        res.json(notificacion);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar notificación' });
    }
});

// Marcar todas como leídas
router.patch('/leer-todas', async (req, res) => {
    try {
        await prisma.notificacion.updateMany({
            where: { leido: false },
            data: { leido: true }
        });
        res.json({ message: 'Todas las notificaciones marcadas como leídas' });
    } catch (error) {
        res.status(500).json({ error: 'Error al marcar todas como leídas' });
    }
});

module.exports = router;
