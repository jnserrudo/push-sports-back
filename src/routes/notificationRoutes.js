const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);

// Listar todas las notificaciones (global) - Solo SUPER_ADMIN
router.get('/', roleMiddleware([1]), async (req, res) => {
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

        if (req.user.id_rol !== 1 && req.user.id_usuario !== id_usuario) {
            return res.status(403).json({ error: 'No tienes permiso para ver estas notificaciones' });
        }

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
        
        // Verificar propiedad
        const noti = await prisma.notificacion.findUnique({ where: { id_notificacion: id } });
        if (!noti) return res.status(404).json({ error: 'Notificación no encontrada' });
        
        if (req.user.id_rol !== 1 && noti.id_usuario !== req.user.id_usuario) {
            return res.status(403).json({ error: 'No autorizado' });
        }

        const notificacion = await prisma.notificacion.update({
            where: { id_notificacion: id },
            data: { leido: true }
        });
        res.json(notificacion);
    } catch (error) {
        res.status(500).json({ error: 'Error al actualizar notificación' });
    }
});

// Marcar todas como leídas del usuario logueado
router.patch('/leer-todas', async (req, res) => {
    try {
        await prisma.notificacion.updateMany({
            where: { leido: false, id_usuario: req.user.id_usuario },
            data: { leido: true }
        });
        res.json({ message: 'Todas las notificaciones marcadas como leídas' });
    } catch (error) {
        res.status(500).json({ error: 'Error al marcar todas como leídas' });
    }
});

module.exports = router;
