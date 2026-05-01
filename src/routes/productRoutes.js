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
                },
                variantes: {
                    select: { 
                        id_variante: true, 
                        sku_variante: true, 
                        atributos_valores: true,
                        stock_central: true,
                        activo: true
                    }
                }
            },
            orderBy: { nombre: 'asc' }
        });

        // Calcular stock_total para el frontend de forma robusta
        const result = productos.map(p => {
            const inventarios = p.inventarios || [];
            const total = inventarios.reduce((acc, inv) => acc + (inv.cantidad_actual || 0), 0);
            const { inventarios: _, ...rest } = p; // Usamos _ para descartar inventarios del objeto final
            return { ...rest, stock_total: total };
        });

        res.json(result);
    } catch (error) {
        console.error('Error GET /productos:', error);
        res.status(500).json({ error: 'Error al obtener productos' });
    }
});

// Obtener un producto por ID
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const producto = await prisma.producto.findUnique({
            where: { id_producto: id },
            include: { 
                marca: true, 
                categoria: true, 
                proveedor: true,
                inventarios: { select: { cantidad_actual: true } },
                variantes: {
                    select: { 
                        id_variante: true, 
                        sku_variante: true, 
                        atributos_valores: true,
                        stock_central: true,
                        activo: true
                    }
                }
            }
        });

        if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

        const inventarios = producto.inventarios || [];
        const total = inventarios.reduce((acc, inv) => acc + (inv.cantidad_actual || 0), 0);
        const { inventarios: _, ...rest } = producto;
        
        res.json({ ...rest, stock_total: total });
    } catch (error) {
        console.error('Error GET /productos/:id:', error);
        res.status(500).json({ error: 'Error al obtener producto' });
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
            imagen_url, stock_minimo, stock_central, activo, atributos
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
        if (atributos !== undefined) {
            // Parse JSON string if needed, or use as-is if already an object
            if (typeof atributos === 'string') {
                try {
                    data.atributos = JSON.parse(atributos);
                } catch (e) {
                    data.atributos = {};
                }
            } else if (typeof atributos === 'object' && atributos !== null) {
                data.atributos = atributos;
            } else {
                data.atributos = {};
            }
        }

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

// Reposición de Stock Central
router.post('/:id/reponer', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id } = req.params;
        const { items, cantidad } = req.body;
        const id_usuario = req.user.id_usuario;

        // Fetch producto
        const producto = await prisma.producto.findUnique({
            where: { id_producto: id },
            include: { variantes: true }
        });

        if (!producto) {
            return res.status(404).json({ error: 'Producto no encontrado' });
        }

        const result = await prisma.$transaction(async (tx) => {
            let cantidadAgregadaTotal = 0;
            const detalles = [];

            const hasVariantes = producto.variantes && producto.variantes.length > 0;

            if (items && items.length > 0 && hasVariantes) {
                // Sumar a cada variante
                for (const item of items) {
                    const cantToAdd = parseInt(item.cantidad);
                    if (cantToAdd > 0) {
                        const v = await tx.productoVariante.update({
                            where: { id_variante: item.id_variante },
                            data: { stock_central: { increment: cantToAdd } }
                        });
                        cantidadAgregadaTotal += cantToAdd;
                        detalles.push({ id_variante: item.id_variante, sku: v.sku_variante, sumado: cantToAdd, stock_posterior: v.stock_central });
                    }
                }
            } else if (cantidad > 0) {
                // Producto simple o forzado como simple
                cantidadAgregadaTotal = parseInt(cantidad);
                detalles.push({ id_producto: id, sumado: cantidadAgregadaTotal, stock_posterior: producto.stock_central + cantidadAgregadaTotal });
            } else {
                throw new Error("Datos de reposición inválidos o cantidades en 0");
            }

            if (cantidadAgregadaTotal <= 0) {
                throw new Error("La cantidad a reponer debe ser mayor a 0");
            }

            // Sumar al total del producto
            const pUpdate = await tx.producto.update({
                where: { id_producto: id },
                data: { stock_central: { increment: cantidadAgregadaTotal } }
            });

            // Registrar en Auditoria
            await tx.auditoriaSistema.create({
                data: {
                    id_usuario,
                    entidad_afectada: 'Producto',
                    id_entidad_afectada: id,
                    accion: 'RESTOCK_CENTRAL',
                    descripcion_accion: `Reposición de ${cantidadAgregadaTotal} unidades en Casa Central`,
                    datos_nuevos: JSON.stringify(detalles),
                    id_producto: id,
                    endpoint: '/api/productos/reponer',
                    metodo_http: 'POST'
                }
            });

            return pUpdate;
        });

        res.json({ message: 'Stock central actualizado exitosamente', producto: result });
    } catch (error) {
        console.error('Error POST /productos/:id/reponer:', error);
        res.status(400).json({ error: error.message || 'Error al reponer stock' });
    }
});

module.exports = router;
