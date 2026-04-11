const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

router.use(authMiddleware);
router.use(roleMiddleware([1]));

// Listar registros de auditoría con filtros avanzados
router.get('/', async (req, res) => {
    try {
        const {
            entidad,
            id_entidad,
            usuario,
            comercio,
            producto,
            venta,
            proveedor,
            accion,
            desde,
            hasta,
            busqueda,
            limit = 100,
            offset = 0
        } = req.query;

        // Construir where dinámico
        const where = {};

        if (entidad) {
            where.entidad_afectada = entidad;
        }

        if (id_entidad) {
            where.id_entidad_afectada = id_entidad;
        }

        if (usuario) {
            where.id_usuario = usuario;
        }

        if (comercio) {
            where.id_comercio = comercio;
        }

        if (producto) {
            where.id_producto = producto;
        }

        if (venta) {
            where.id_venta = venta;
        }

        if (proveedor) {
            where.id_proveedor = proveedor;
        }

        if (accion) {
            where.accion = accion.toUpperCase();
        }

        // Filtro de fechas
        if (desde || hasta) {
            where.fecha_hora = {};
            if (desde) {
                where.fecha_hora.gte = new Date(desde);
            }
            if (hasta) {
                where.fecha_hora.lte = new Date(hasta);
            }
        }

        // Búsqueda por texto en descripción
        if (busqueda) {
            where.descripcion_accion = {
                contains: busqueda,
                mode: 'insensitive'
            };
        }

        const [auditorias, total] = await Promise.all([
            prisma.auditoriaSistema.findMany({
                where,
                include: { usuario: true },
                orderBy: { fecha_hora: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.auditoriaSistema.count({ where })
        ]);

        res.json({
            data: auditorias,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error en auditoría:', error);
        res.status(500).json({ error: 'Error al obtener registros de auditoría' });
    }
});

// Auditoría por entidad específica (ej: solo Producto)
router.get('/entidad/:nombre', async (req, res) => {
    try {
        const { nombre } = req.params;
        const { id_entidad, limit = 100 } = req.query;

        const where = { entidad_afectada: nombre };
        if (id_entidad) {
            where.id_entidad_afectada = id_entidad;
        }

        const auditorias = await prisma.auditoriaSistema.findMany({
            where,
            include: { usuario: true },
            orderBy: { fecha_hora: 'desc' },
            take: parseInt(limit)
        });

        res.json(auditorias);
    } catch (error) {
        console.error('Error en auditoría por entidad:', error);
        res.status(500).json({ error: 'Error al obtener auditoría de la entidad' });
    }
});

// Historial completo de una entidad específica por su ID
router.get('/historial/:entidad/:id', async (req, res) => {
    try {
        const { entidad, id } = req.params;

        const auditorias = await prisma.auditoriaSistema.findMany({
            where: {
                entidad_afectada: entidad,
                id_entidad_afectada: id
            },
            include: { usuario: true },
            orderBy: { fecha_hora: 'desc' }
        });

        res.json(auditorias);
    } catch (error) {
        console.error('Error en historial:', error);
        res.status(500).json({ error: 'Error al obtener historial de la entidad' });
    }
});

// Estadísticas de auditoría
router.get('/estadisticas/resumen', async (req, res) => {
    try {
        const { desde, hasta } = req.query;

        const where = {};
        if (desde || hasta) {
            where.fecha_hora = {};
            if (desde) where.fecha_hora.gte = new Date(desde);
            if (hasta) where.fecha_hora.lte = new Date(hasta);
        }

        const [porEntidad, porAccion, total] = await Promise.all([
            prisma.auditoriaSistema.groupBy({
                by: ['entidad_afectada'],
                where,
                _count: { id_auditoria: true }
            }),
            prisma.auditoriaSistema.groupBy({
                by: ['accion'],
                where,
                _count: { id_auditoria: true }
            }),
            prisma.auditoriaSistema.count({ where })
        ]);

        res.json({
            total,
            por_entidad: porEntidad,
            por_accion: porAccion
        });
    } catch (error) {
        console.error('Error en estadísticas:', error);
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

module.exports = router;
