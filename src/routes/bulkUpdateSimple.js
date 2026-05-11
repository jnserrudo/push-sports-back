const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Actualización masiva de precios SIMPLE (Solo SUPER_ADMIN)
router.put('/productos/bulk-update-prices', authMiddleware, roleMiddleware([1]), async (req, res) => {
    console.log('========== BULK UPDATE SIMPLE ==========');
    console.log('Request body:', req.body);
    console.log('User:', req.user);
    
    try {
        const { productIds, percentage, applyTo } = req.body;
        const id_usuario = req.user.id_usuario;

        console.log('Bulk update request:', { productIds, percentage, applyTo, id_usuario });

        // Validaciones
        if (!percentage || !applyTo) {
            return res.status(400).json({ error: 'Faltan parámetros: percentage y applyTo son obligatorios' });
        }

        const percentageNum = parseFloat(percentage);
        if (isNaN(percentageNum) || percentageNum < -100 || percentageNum > 1000) {
            return res.status(400).json({ error: 'El porcentaje debe estar entre -100 y 1000' });
        }

        if (!['precio_venta_sugerido', 'precio_pushsport', 'both'].includes(applyTo)) {
            return res.status(400).json({ error: 'applyTo debe ser: precio_venta_sugerido, precio_pushsport o both' });
        }

        // Determinar qué productos actualizar
        const whereClause = productIds && productIds.length > 0
            ? { id_producto: { in: productIds }, activo: true }
            : { activo: true };

        const productosAActualizar = await prisma.producto.findMany({
            where: whereClause,
            select: {
                id_producto: true,
                nombre: true,
                precio_venta_sugerido: true,
                precio_pushsport: true
            }
        });

        console.log('Productos a actualizar:', productosAActualizar.length);

        if (productosAActualizar.length === 0) {
            return res.status(404).json({ error: 'No se encontraron productos para actualizar' });
        }

        const factor = 1 + (percentageNum / 100);
        const updatedProducts = [];

        // Actualizar productos uno por uno SIN transacción
        for (const producto of productosAActualizar) {
            const updateData = {};

            if (applyTo === 'precio_venta_sugerido' || applyTo === 'both') {
                const precioAnterior = parseFloat(producto.precio_venta_sugerido) || 0;
                const precioNuevo = Math.max(0, Math.round(precioAnterior * factor * 100) / 100);
                updateData.precio_venta_sugerido = precioNuevo;
            }

            if (applyTo === 'precio_pushsport' || applyTo === 'both') {
                const precioAnterior = parseFloat(producto.precio_pushsport) || 0;
                const precioNuevo = Math.max(0, Math.round(precioAnterior * factor * 100) / 100);
                updateData.precio_pushsport = precioNuevo;
            }

            try {
                const updated = await prisma.producto.update({
                    where: { id_producto: producto.id_producto },
                    data: updateData,
                    include: { marca: true, categoria: true }
                });
                updatedProducts.push(updated);
                console.log('✅ Producto actualizado:', producto.nombre);
            } catch (error) {
                console.error('❌ Error actualizando producto:', producto.nombre, error.message);
                // Continuar con los demás productos
            }
        }

        console.log('✅ Actualización completada:', updatedProducts.length, 'productos');

        res.json({
            message: `${updatedProducts.length} producto${updatedProducts.length !== 1 ? 's' : ''} actualizado${updatedProducts.length !== 1 ? 's' : ''} exitosamente`,
            count: updatedProducts.length,
            percentage: percentageNum,
            applyTo,
            products: updatedProducts
        });
    } catch (error) {
        console.error('Error PUT /productos/bulk-update-prices:', error);
        res.status(500).json({ error: 'Error al actualizar precios masivamente', detail: error.message });
    }
});

module.exports = router;
