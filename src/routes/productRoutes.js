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
                codigo_producto: true,
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
                codigo_producto: true,
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
    console.log('========== CREACIÓN DE PRODUCTO ==========');
    console.log('Usuario:', req.user ? { id: req.user.id_usuario, nombre: req.user.nombre, rol: req.user.id_rol } : 'No autenticado');
    console.log('Body recibido:', req.body);

    try {
        const {
            nombre, descripcion,
            id_categoria, id_marca, id_proveedor, id_codigo_producto,
            precio_venta_sugerido, precio_pushsport, costo_compra,
            imagen_url, stock_minimo, stock_central, atributos
        } = req.body;

        console.log('Campos extraídos:', {
            nombre,
            descripcion,
            id_categoria,
            id_marca,
            id_proveedor,
            precio_venta_sugerido,
            precio_pushsport,
            costo_compra,
            imagen_url,
            stock_minimo,
            stock_central,
            atributos
        });

        if (!nombre || !id_categoria || !id_marca || !precio_venta_sugerido || !costo_compra) {
            console.error('Error de validación: Faltan campos obligatorios');
            console.error('Campos faltantes:', {
                nombre: !nombre,
                id_categoria: !id_categoria,
                id_marca: !id_marca,
                precio_venta_sugerido: !precio_venta_sugerido,
                costo_compra: !costo_compra
            });
            return res.status(400).json({ error: 'Faltan campos obligatorios: nombre, categoría, marca y precios.' });
        }

        console.log('Validación exitosa, procediendo a crear producto...');

        const data = {
            nombre: nombre.toUpperCase(),
            descripcion: descripcion || null,
            id_categoria: parseInt(id_categoria),
            id_marca: parseInt(id_marca),
            id_proveedor: id_proveedor || null,
            id_codigo_producto: id_codigo_producto || null,
            precio_venta_sugerido: parseFloat(precio_venta_sugerido),
            precio_pushsport: precio_pushsport !== undefined ? parseFloat(precio_pushsport) : 0,
            costo_compra: parseFloat(costo_compra),
            imagen_url: imagen_url || null,
            stock_minimo: stock_minimo ? parseInt(stock_minimo) : 5,
            stock_central: stock_central !== undefined ? parseInt(stock_central) : 0,
        };

        if (atributos !== undefined) {
            console.log('Procesando atributos:', atributos);
            if (typeof atributos === 'string') {
                try {
                    data.atributos = JSON.parse(atributos);
                    console.log('Atributos parseados correctamente:', data.atributos);
                } catch (e) {
                    console.error('Error al parsear atributos (string):', e);
                    data.atributos = {};
                }
            } else if (typeof atributos === 'object' && atributos !== null) {
                data.atributos = atributos;
                console.log('Atributos recibidos como objeto:', data.atributos);
            } else {
                console.warn('Atributos en formato inválido, usando objeto vacío');
                data.atributos = {};
            }
        }

        console.log('Datos a insertar en DB:', data);

        const producto = await prisma.producto.create({
            data,
            include: { marca: true, categoria: true, proveedor: true }
        });

        console.log('Producto creado exitosamente:', {
            id: producto.id_producto,
            nombre: producto.nombre,
            categoria: producto.categoria?.nombre,
            marca: producto.marca?.nombre
        });

        res.status(201).json(producto);
    } catch (error) {
        console.error('========== ERROR EN CREACIÓN DE PRODUCTO ==========');
        console.error('Error completo:', error);
        console.error('Mensaje de error:', error.message);
        console.error('Stack trace:', error.stack);
        console.error('Código de error:', error.code);
        console.error('Meta:', error.meta);

        if (error.code === 'P2002') {
            console.error('Error de unicidad:', error.meta);
            return res.status(400).json({ error: 'Ya existe un producto con esos datos únicos', detail: error.message });
        }

        if (error.code === 'P2003') {
            console.error('Error de clave foránea:', error.meta);
            return res.status(400).json({ error: 'Error de referencia: categoría, marca o proveedor no válido', detail: error.message });
        }

        if (error.code === 'P2025') {
            console.error('Registro no encontrado:', error.meta);
            return res.status(404).json({ error: 'Registro relacionado no encontrado', detail: error.message });
        }

        res.status(500).json({ error: 'Error al crear producto', detail: error.message, code: error.code });
    }
});

// Actualización masiva de precios (Solo SUPER_ADMIN) - DEBE IR ANTES DE /:id
router.put('/bulk-update-prices', authMiddleware, roleMiddleware([1]), async (req, res) => {
    console.log('========== BULK UPDATE ENDPOINT CALLED ==========');
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

        if (productosAActualizar.length === 0) {
            return res.status(404).json({ error: 'No se encontraron productos para actualizar' });
        }

        const factor = 1 + (percentageNum / 100);
        const updatedProducts = [];
        const auditDetails = [];

        console.log('Productos a actualizar:', productosAActualizar.length);

        // Ejecutar actualización en transacción con timeout extendido
        await prisma.$transaction(async (tx) => {
            for (const producto of productosAActualizar) {
                const updateData = {};
                const cambios = {};

                if (applyTo === 'precio_venta_sugerido' || applyTo === 'both') {
                    const precioAnterior = parseFloat(producto.precio_venta_sugerido) || 0;
                    const precioNuevo = Math.max(0, Math.round(precioAnterior * factor * 100) / 100);
                    updateData.precio_venta_sugerido = precioNuevo;
                    cambios.precio_venta_sugerido = { anterior: precioAnterior, nuevo: precioNuevo };
                }

                if (applyTo === 'precio_pushsport' || applyTo === 'both') {
                    const precioAnterior = parseFloat(producto.precio_pushsport) || 0;
                    const precioNuevo = Math.max(0, Math.round(precioAnterior * factor * 100) / 100);
                    updateData.precio_pushsport = precioNuevo;
                    cambios.precio_pushsport = { anterior: precioAnterior, nuevo: precioNuevo };
                }

                // Actualizar producto
                const updated = await tx.producto.update({
                    where: { id_producto: producto.id_producto },
                    data: updateData,
                    include: { marca: true, categoria: true }
                });

                updatedProducts.push(updated);

                // Registrar en auditoría individual
                try {
                    await tx.auditoriaSistema.create({
                        data: {
                            id_usuario,
                            entidad_afectada: 'Producto',
                            id_entidad_afectada: producto.id_producto,
                            accion: 'BULK_PRICE_UPDATE',
                            descripcion_accion: `Actualización masiva de precios: ${percentageNum > 0 ? '+' : ''}${percentageNum}% en ${applyTo}`,
                            datos_anteriores: JSON.stringify({
                                nombre: producto.nombre,
                                precio_venta_sugerido: producto.precio_venta_sugerido,
                                precio_pushsport: producto.precio_pushsport
                            }),
                            datos_nuevos: JSON.stringify({
                                nombre: producto.nombre,
                                cambios,
                                porcentaje_aplicado: percentageNum
                            }),
                            id_producto: producto.id_producto,
                            endpoint: '/api/productos/bulk-update-prices',
                            metodo_http: 'PUT'
                        }
                    });
                } catch (auditError) {
                    console.error('Error en auditoría individual:', auditError);
                    // Continuar con la actualización aunque falle la auditoría
                }

                auditDetails.push({
                    id_producto: producto.id_producto,
                    nombre: producto.nombre,
                    cambios
                });
            }

            // Registro de auditoría resumen
            try {
                await tx.auditoriaSistema.create({
                    data: {
                        id_usuario,
                        entidad_afectada: 'Producto',
                        id_entidad_afectada: null,
                        accion: 'BULK_PRICE_UPDATE',
                        descripcion_accion: `Actualización masiva: ${updatedProducts.length} productos, ${percentageNum > 0 ? '+' : ''}${percentageNum}% en ${applyTo}`,
                        datos_nuevos: JSON.stringify({
                            cantidad_productos: updatedProducts.length,
                            porcentaje: percentageNum,
                            campo_afectado: applyTo,
                            resumen: auditDetails.slice(0, 10) // Primeros 10 para el resumen
                        }),
                        endpoint: '/api/productos/bulk-update-prices',
                        metodo_http: 'PUT'
                    }
                });
            } catch (auditError) {
                console.error('Error en auditoría resumen:', auditError);
                // Continuar aunque falle la auditoría
            }
        }, {
            maxWait: 30000, // 30 segundos
            timeout: 60000, // 60 segundos
        });

        console.log('Actualización masiva completada:', updatedProducts.length, 'productos');

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

// Actualizar un producto (SUPER_ADMIN / ADMIN_SUCURSAL)
router.put('/:id', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            nombre, descripcion,
            id_categoria, id_marca, id_proveedor, id_codigo_producto,
            precio_venta_sugerido, precio_pushsport, costo_compra,
            imagen_url, stock_minimo, stock_central, activo, atributos
        } = req.body;

        const data = {};
        if (nombre !== undefined)                data.nombre = nombre.toUpperCase();
        if (descripcion !== undefined)           data.descripcion = descripcion || null;
        if (id_categoria !== undefined)          data.id_categoria = parseInt(id_categoria);
        if (id_marca !== undefined)              data.id_marca = parseInt(id_marca);
        if (id_proveedor !== undefined)          data.id_proveedor = id_proveedor || null;
        if (id_codigo_producto !== undefined)    data.id_codigo_producto = id_codigo_producto || null;
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
