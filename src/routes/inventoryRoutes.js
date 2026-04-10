const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');
const { notifyCommerceManagers } = require('../services/notificationService');

// Listar inventario de un comercio
// SI es Supervisor (2) o Vendedor (3), solo puede ver el suyo.
router.get('/:id_comercio', authMiddleware, async (req, res) => {
    try {
        const { id_comercio } = req.params;

        // Filtro de seguridad por rol
        if ((req.user.id_rol === 2 || req.user.id_rol === 3) && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para ver el inventario de otro comercio' });
        }

        const inventario = await prisma.inventarioComercio.findMany({
            where: { id_comercio, producto: { activo: true } },
            include: { 
                producto: {
                    include: {
                        variantes: {
                            where: { activo: true },
                            select: {
                                id_variante: true,
                                sku_variante: true,
                                atributos_valores: true
                            }
                        }
                    }
                },
                variantes: {
                    where: { cantidad_actual: { gt: 0 } },
                    include: {
                        variante: {
                            select: {
                                id_variante: true,
                                sku_variante: true,
                                atributos_valores: true
                            }
                        }
                    }
                }
            }
        });
        res.json(inventario);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener inventario' });
    }
});

// Actualizar parámetros de inventario (Stock mínimo, Comisión)
router.put('/:id_inventario', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id_inventario } = req.params;
        const { stock_minimo_alerta, comision_pactada_porcentaje, cantidad_actual } = req.body;

        // Verificar pertenencia si es Supervisor
        if (req.user.id_rol === 2) {
            const inv = await prisma.inventarioComercio.findUnique({ where: { id_inventario } });
            if (inv.id_comercio !== req.user.id_comercio_asignado) {
                return res.status(403).json({ error: 'Solo puedes editar inventario de tu propio comercio' });
            }
        }

        const updated = await prisma.inventarioComercio.update({
            where: { id_inventario },
            data: {
                stock_minimo_alerta: stock_minimo_alerta !== undefined ? parseInt(stock_minimo_alerta) : undefined,
                comision_pactada_porcentaje: comision_pactada_porcentaje !== undefined ? parseFloat(comision_pactada_porcentaje) : undefined,
                cantidad_actual: cantidad_actual !== undefined ? parseInt(cantidad_actual) : undefined
            },
            include: { producto: true }
        });

        // Alerta de stock bajo si se actualizó la cantidad
        if (cantidad_actual !== undefined && cantidad_actual <= updated.stock_minimo_alerta) {
            await notifyCommerceManagers(updated.id_comercio, {
                titulo: 'Alerta: Stock Bajo',
                mensaje: `El producto "${updated.producto.nombre}" ha llegado al límite mínimo (${cantidad_actual} unidades) en tu sede.`,
                tipo: 'COMMERCE'
            });
        }

        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar inventario' });
    }
});

// Vincular nuevo producto a un comercio (Solo SUPER_ADMIN)
router.post('/', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id_comercio, id_producto, stock_minimo_alerta, comision_pactada_porcentaje, cantidad_actual } = req.body;

        const inv = await prisma.inventarioComercio.create({
            data: {
                id_comercio,
                id_producto,
                stock_minimo_alerta: stock_minimo_alerta ? parseInt(stock_minimo_alerta) : 5,
                comision_pactada_porcentaje: comision_pactada_porcentaje ? parseFloat(comision_pactada_porcentaje) : 0,
                cantidad_actual: cantidad_actual ? parseInt(cantidad_actual) : 0
            },
            include: { producto: true }
        });

        // Notificar a los managers de la sede
        await notifyCommerceManagers(id_comercio, {
            titulo: 'Nuevo Producto Asignado',
            mensaje: `Se ha asignado el producto "${inv.producto.nombre}" a tu sede con un stock inicial de ${inv.cantidad_actual} unidades.`,
            tipo: 'COMMERCE'
        });

        res.status(201).json(inv);
    } catch (error) {
        res.status(500).json({ error: 'Error al vincular producto al comercio' });
    }
});
// Desvincular producto de un comercio (Solo SUPER_ADMIN)
router.delete('/:id_inventario', authMiddleware, roleMiddleware([1]), async (req, res) => {
    try {
        const { id_inventario } = req.params;
        await prisma.inventarioComercio.delete({ where: { id_inventario } });
        res.json({ message: 'Producto desvinculado del comercio correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al desvincular producto' });
    }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINTS PARA VARIANTES
// ═══════════════════════════════════════════════════════════

// Obtener stock de una variante específica en un comercio
router.get('/:id_comercio/variantes/:id_variante', authMiddleware, async (req, res) => {
    try {
        const { id_comercio, id_variante } = req.params;

        // Filtro de seguridad por rol
        if ((req.user.id_rol === 2 || req.user.id_rol === 3) && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para ver este inventario' });
        }

        // Buscar o crear el registro de inventario para la variante
        let inventarioVariante = await prisma.inventarioComercioVariante.findFirst({
            where: { 
                variante: { id_variante },
                inventario_padre: { id_comercio }
            },
            include: {
                variante: {
                    select: {
                        id_variante: true,
                        sku_variante: true,
                        atributos_valores: true,
                        producto: {
                            select: {
                                id_producto: true,
                                nombre: true
                            }
                        }
                    }
                }
            }
        });

        // Si no existe, retornar stock 0 pero no crear aún
        if (!inventarioVariante) {
            const variante = await prisma.productoVariante.findUnique({
                where: { id_variante },
                include: {
                    producto: {
                        select: { id_producto: true, nombre: true }
                    }
                }
            });

            if (!variante) {
                return res.status(404).json({ error: 'Variante no encontrada' });
            }

            return res.json({
                variante,
                cantidad_actual: 0,
                stock_minimo_alerta: 5,
                existe: false
            });
        }

        res.json(inventarioVariante);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al obtener stock de variante' });
    }
});

// Actualizar stock de una variante específica (o crear si no existe)
router.put('/:id_comercio/variantes/:id_variante', authMiddleware, roleMiddleware([1, 2]), async (req, res) => {
    try {
        const { id_comercio, id_variante } = req.params;
        const { cantidad_actual, stock_minimo_alerta } = req.body;

        // Verificar pertenencia si es Supervisor
        if (req.user.id_rol === 2 && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'Solo puedes editar inventario de tu propio comercio' });
        }

        // Buscar el inventario padre
        let inventarioPadre = await prisma.inventarioComercio.findUnique({
            where: { 
                id_comercio_id_producto: {
                    id_comercio,
                    id_producto: (await prisma.productoVariante.findUnique({ 
                        where: { id_variante },
                        select: { id_producto: true }
                    }))?.id_producto
                }
            }
        });

        // Si no existe inventario padre, crearlo
        if (!inventarioPadre) {
            const variante = await prisma.productoVariante.findUnique({
                where: { id_variante },
                select: { id_producto: true }
            });

            if (!variante) {
                return res.status(404).json({ error: 'Variante no encontrada' });
            }

            inventarioPadre = await prisma.inventarioComercio.create({
                data: {
                    id_comercio,
                    id_producto: variante.id_producto,
                    cantidad_actual: 0,
                    stock_minimo_alerta: stock_minimo_alerta ? parseInt(stock_minimo_alerta) : 5,
                    comision_pactada_porcentaje: 0
                }
            });
        }

        // Buscar o crear el inventario de variante
        let inventarioVariante = await prisma.inventarioComercioVariante.findUnique({
            where: {
                id_inventario_id_variante: {
                    id_inventario: inventarioPadre.id_inventario,
                    id_variante
                }
            }
        });

        const data = {};
        if (cantidad_actual !== undefined) data.cantidad_actual = parseInt(cantidad_actual);
        if (stock_minimo_alerta !== undefined) data.stock_minimo_alerta = parseInt(stock_minimo_alerta);

        if (inventarioVariante) {
            // Actualizar existente
            inventarioVariante = await prisma.inventarioComercioVariante.update({
                where: { id_inventario_var: inventarioVariante.id_inventario_var },
                data,
                include: {
                    variante: {
                        select: {
                            id_variante: true,
                            sku_variante: true,
                            atributos_valores: true
                        }
                    }
                }
            });
        } else {
            // Crear nuevo
            inventarioVariante = await prisma.inventarioComercioVariante.create({
                data: {
                    id_inventario: inventarioPadre.id_inventario,
                    id_variante,
                    cantidad_actual: cantidad_actual ? parseInt(cantidad_actual) : 0,
                    stock_minimo_alerta: stock_minimo_alerta ? parseInt(stock_minimo_alerta) : 5
                },
                include: {
                    variante: {
                        select: {
                            id_variante: true,
                            sku_variante: true,
                            atributos_valores: true
                        }
                    }
                }
            });
        }

        // Alerta de stock bajo
        if (cantidad_actual !== undefined && cantidad_actual <= inventarioVariante.stock_minimo_alerta) {
            const atributos = inventarioVariante.variante?.atributos_valores || {};
            const nombreVariante = Object.values(atributos).join(' / ');
            
            await notifyCommerceManagers(id_comercio, {
                titulo: 'Alerta: Stock Bajo de Variante',
                mensaje: `La variante "${nombreVariante}" ha llegado al límite mínimo (${cantidad_actual} unidades) en tu sede.`,
                tipo: 'COMMERCE'
            });
        }

        res.json(inventarioVariante);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al actualizar stock de variante' });
    }
});

module.exports = router;
