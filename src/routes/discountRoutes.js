const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Validar y aplicar un código de descuento en el POS
router.post('/validar', authMiddleware, async (req, res) => {
    try {
        const { codigo, subtotal } = req.body;

        if (!codigo || subtotal === undefined) {
            return res.status(400).json({ error: 'Código y subtotal son obligatorios' });
        }

        const descuento = await prisma.descuento.findFirst({
            where: { codigo: codigo.toUpperCase(), activo: true }
        });

        if (!descuento) {
            return res.status(404).json({ error: 'Código no válido o inactivo' });
        }

        if (descuento.usos_maximos !== null && descuento.usos_actuales >= descuento.usos_maximos) {
            return res.status(400).json({ error: 'El código ya alcanzó el límite de usos' });
        }

        const sub = parseFloat(subtotal);
        let montoDescuento = 0;
        if (descuento.tipo_descuento === 'porcentaje') {
            montoDescuento = sub * (parseFloat(descuento.valor_descuento) / 100);
        } else {
            montoDescuento = Math.min(parseFloat(descuento.valor_descuento), sub);
        }

        const totalFinal = Math.max(0, sub - montoDescuento);

        // Incrementar usos
        await prisma.descuento.update({
            where: { id_descuento: descuento.id_descuento },
            data: { usos_actuales: { increment: 1 } }
        });

        res.json({
            valido: true,
            id_descuento: descuento.id_descuento,
            codigo: descuento.codigo,
            tipo_descuento: descuento.tipo_descuento,
            valor_descuento: parseFloat(descuento.valor_descuento),
            monto_descuento: montoDescuento,
            total_final: totalFinal
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al validar descuento' });
    }
});

// Listar descuentos
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const descuentos = await prisma.descuento.findMany({
            where: canSeeInactive ? {} : { activo: true },
            orderBy: { fecha_creacion: 'desc' }
        });
        res.json(descuentos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener descuentos' });
    }
});

// Crear descuento (Solo SUPER_ADMIN)
router.post('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { codigo, tipo_descuento, valor_descuento, usos_maximos } = req.body;

        if (!codigo || !valor_descuento) {
            return res.status(400).json({ error: 'Código y valor son obligatorios' });
        }

        const descuento = await prisma.descuento.create({
            data: {
                codigo: codigo.toUpperCase(),
                tipo_descuento: tipo_descuento || 'porcentaje',
                valor_descuento: parseFloat(valor_descuento),
                usos_maximos: usos_maximos ? parseInt(usos_maximos) : null
            }
        });
        res.status(201).json(descuento);
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({ error: 'El código ya existe' });
        }
        console.error(error);
        res.status(500).json({ error: 'Error al crear descuento' });
    }
});

// Actualizar descuento (Solo SUPER_ADMIN)
router.put('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        const data = req.body;

        if (data.codigo) data.codigo = data.codigo.toUpperCase();
        if (data.valor_descuento) data.valor_descuento = parseFloat(data.valor_descuento);
        if (data.usos_maximos !== undefined) data.usos_maximos = data.usos_maximos ? parseInt(data.usos_maximos) : null;

        const descuento = await prisma.descuento.update({
            where: { id_descuento: id },
            data
        });
        res.json(descuento);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar descuento' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.descuento.update({
            where: { id_descuento: id },
            data: { activo: false }
        });
        res.json({ message: 'Descuento desactivado correctamente' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al eliminar descuento' });
    }
});

module.exports = router;
