const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.use(roleMiddleware([1]));

// Listar todos los registros de auditoría
router.get('/', async (req, res) => {
    try {
        const auditorias = await prisma.auditoriaSistema.findMany({
            include: { usuario: true },
            orderBy: { fecha_hora: 'desc' }
        });
        res.json(auditorias);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener registros de auditoría' });
    }
});

// Auditoría por entidad (ej: solo Producto)
router.get('/entidad/:nombre', async (req, res) => {
    try {
        const { nombre } = req.params;
        const auditorias = await prisma.auditoriaSistema.findMany({
            where: { entidad_afectada: nombre },
            include: { usuario: true },
            orderBy: { fecha_hora: 'desc' }
        });
        res.json(auditorias);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener auditoría de la entidad' });
    }
});

module.exports = router;
