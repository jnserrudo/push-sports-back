const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// Obtener todos los productos
router.get('/', authMiddleware, async (req, res) => {
    try {
        const { includeInactive } = req.query;
        const canSeeInactive = req.user.id_rol === 1 && includeInactive === 'true';

        const productos = await prisma.producto.findMany({
            where: canSeeInactive ? {} : { activo: true },
            include: { 
                marca: true, 
                categoria: true, 
                proveedor: true,
                inventarios: {
                    select: { cantidad_actual: true }
                }
            },
            orderBy: { nombre: 'asc' }
        });

        // Calcular stock_total para el frontend
        const result = productos.map(p => {
            const total = p.inventarios.reduce((acc, inv) => acc + (inv.cantidad_actual || 0), 0);
            const { inventarios, ...rest } = p;
            return { ...rest, stock_total: total };
        });

        res.json(result);
    } catch (error) {
        console.error('Error GET /productos:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// Crear un producto (SUPER_ADMIN / ADMIN_SUCURSAL)
router.post('/', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const {
            nombre, descripcion,
            id_categoria, id_marca, id_proveedor,
            precio_venta_sugerido, precio_pushsport, costo_compra,
            imagen_url, stock_minimo, stock_central
        } = req.body;

        if (!nombre || !id_categoria || !id_marca || !precio_venta_sugerido || !costo_compra) {
            return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, categoría, marca y precios.' });
        }

        const producto = await prisma.producto.create({
            data: {
                nombre: nombre.toUpperCase(),
                descripcion: descripcion || null,
                id_categoria: parseInt(id_categoria),
                id_marca: parseInt(id_marca),
                id_proveedor: id_proveedor || null,
                precio_venta_sugerido: parseFloat(precio_venta_sugerido),
                precio_pushsport: precio_pushsport !== undefined ? parseFloat(precio_pushsport) : 0,
                costo_compra: parseFloat(costo_compra),
                imagen_url: imagen_url || null,
                stock_minimo: stock_minimo ? parseInt(stock_minimo) : 5,
                stock_central: stock_central !== undefined ? parseInt(stock_central) : 0,
            },
            include: { marca: true, categoria: true, proveedor: true }
        });
        res.status(201).json(producto);
    } catch (error) {
        console.error('Error POST /productos:', error);
        res.status(500).json({ error: 'Error al crear producto', detail: error.message });
    }
});

// Actualizar un producto (SUPER_ADMIN / ADMIN_SUCURSAL)
router.put('/:id', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre, descripcion,
            id_categoria, id_marca, id_proveedor,
            precio_venta_sugerido, precio_pushsport, costo_compra,
            imagen_url, stock_minimo, stock_central, activo
        } = req.body;

        const data = {};
        if (nombre !== undefined)                data.nombre = nombre.toUpperCase();
        if (descripcion !== undefined)           data.descripcion = descripcion || null;
        if (id_categoria !== undefined)          data.id_categoria = parseInt(id_categoria);
        if (id_marca !== undefined)              data.id_marca = parseInt(id_marca);
        if (id_proveedor !== undefined)          data.id_proveedor = id_proveedor || null;
        if (precio_venta_sugerido !== undefined) data.precio_venta_sugerido = parseFloat(precio_venta_sugerido);
        if (precio_pushsport !== undefined)      data.precio_pushsport = parseFloat(precio_pushsport);
        if (costo_compra !== undefined)          data.costo_compra = parseFloat(costo_compra);
        if (imagen_url !== undefined)            data.imagen_url = imagen_url || null;
        if (stock_minimo !== undefined)          data.stock_minimo = parseInt(stock_minimo);
        if (stock_central !== undefined)         data.stock_central = parseInt(stock_central);
        if (activo !== undefined)                data.activo = activo;

        const producto = await prisma.producto.update({
            where: { id_producto: id },
            data,
            include: { marca: true, categoria: true, proveedor: true }
        });
        res.json(producto);
    } catch (error) {
        console.error('Error PUT /productos:', error);
        res.status(500).json({ error: 'Error al actualizar producto' });
    }
});

// Soft Delete (Solo SUPER_ADMIN)
router.delete('/:id', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.producto.update({
            where: { id_producto: id },
            data: { activo: false }
        });
        res.json({ message: 'Producto desactivado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al desactivar producto' });
    }
});

module.exports = router;
