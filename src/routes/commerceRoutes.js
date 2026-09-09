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

// Obtener comercio por ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const comercio = await prisma.comercio.findUnique({
            where: { id_comercio: id },
            include: { tipo_comercio: true }
        });
        if (!comercio) {
            return res.status(404).json({ error: 'Comercio no encontrado' });
        }
        res.json(comercio);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener comercio' });
    }
});

// Listar comercios (Para el Dashboard, con auth)
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const comercios = await prisma.comercio.findMany({
            where: canSeeInactive ? {} : { activo: true },
            include: {
                tipo_comercio: true,
                ventas_registradas: {
                    where: { id_liquidacion: null, estado: 'ACTIVA' },
                    select: {
                        total_venta: true,
                        fecha_hora: true,
                        detalles: {
                            select: { precio_pushsport_historico: true, cantidad: true }
                        }
                    },
                    orderBy: { fecha_hora: 'desc' }
                }
            }
        });

        const netoPush = (venta) => (venta.detalles || []).reduce(
            (acc, d) => acc + (parseFloat(d.precio_pushsport_historico) || 0) * d.cantidad,
            0
        );

        const mapped = comercios.map(({ ventas_registradas = [], ...comercio }) => {
            const tickets = ventas_registradas.length;
            const ultima = ventas_registradas[0] || null;
            const ultimaPush = ultima ? netoPush(ultima) : 0;
            const anterioresPush = ventas_registradas.slice(1).reduce((acc, v) => acc + netoPush(v), 0);
            return {
                ...comercio,
                _count: { ventas_registradas: tickets },
                resumen_pendiente: {
                    tickets,
                    ultima_push: Math.round(ultimaPush * 100) / 100,
                    ultima_publico: ultima ? Math.round(Number(ultima.total_venta) * 100) / 100 : 0,
                    ultima_fecha: ultima?.fecha_hora || null,
                    anteriores_push: Math.round(anterioresPush * 100) / 100
                }
            };
        });
        res.json(mapped);
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

        // Supervisor solo puede editar su propio comercio (salvo supervisor global)
        if (req.user.id_rol === 2 && req.user.id_comercio_asignado && req.user.id_comercio_asignado !== id) {
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
