const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');

const { authMiddleware } = require('../middlewares/authMiddleware');
const { notifyCommerceManagers } = require('../services/notificationService');

// ═══════════════════════════════════════════════════════════
// LISTAR MOVIMIENTOS DE STOCK CON FILTROS AVANZADOS + PAGINACIÓN
// ═══════════════════════════════════════════════════════════
router.get('/', authMiddleware, async (req, res) => {
    try {
        const {
            desde,
            hasta,
            id_usuario,
            id_tipo_movimiento,
            id_producto,
            busqueda,
            limit = 50,
            offset = 0
        } = req.query;

        // Construir where dinámico
        const where = {};

        // Roles 2 y 3 solo pueden ver movimientos de su propio comercio (salvo supervisor global)
        const isGlobalSupervisor = req.user.id_rol === 2 && !req.user.id_comercio_asignado;
        if (!isGlobalSupervisor && (req.user.id_rol === 2 || req.user.id_rol === 3)) {
            where.id_comercio = req.user.id_comercio_asignado;
        }

        // Filtro de fechas
        if (desde || hasta) {
            where.fecha_hora = {};
            if (desde) where.fecha_hora.gte = new Date(desde);
            if (hasta) {
                const hastaDate = new Date(hasta);
                hastaDate.setHours(23, 59, 59, 999);
                where.fecha_hora.lte = hastaDate;
            }
        }

        // Filtro por usuario
        if (id_usuario) {
            where.id_usuario = id_usuario;
        }

        // Filtro por tipo de movimiento
        if (id_tipo_movimiento) {
            where.id_tipo_movimiento = parseInt(id_tipo_movimiento);
        }

        // Filtro por producto
        if (id_producto) {
            where.id_producto = id_producto;
        }

        // Búsqueda por texto en nombre de producto
        if (busqueda) {
            where.OR = [
                { producto: { nombre: { contains: busqueda, mode: 'insensitive' } } },
                { comercio: { nombre: { contains: busqueda, mode: 'insensitive' } } },
                { usuario: { nombre: { contains: busqueda, mode: 'insensitive' } } },
                { usuario: { apellido: { contains: busqueda, mode: 'insensitive' } } }
            ];
        }

        const [movimientos, total] = await Promise.all([
            prisma.movimientoStock.findMany({
                where,
                include: {
                    producto: true,
                    comercio: true,
                    usuario: true,
                    tipo_movimiento: true,
                    variantes: {
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
                },
                orderBy: { fecha_hora: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.movimientoStock.count({ where })
        ]);

        // Obtener tipos de movimiento para el frontend
        const tiposMovimiento = await prisma.tipoMovimiento.findMany({
            orderBy: { id_tipo_movimiento: 'asc' }
        });

        // Obtener usuarios que han hecho movimientos (para filtro)
        const usuariosConMovimientos = await prisma.movimientoStock.findMany({
            select: {
                usuario: {
                    select: {
                        id_usuario: true,
                        nombre: true,
                        apellido: true
                    }
                }
            },
            distinct: ['id_usuario']
        });

        res.json({
            data: movimientos,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
            tipos_movimiento: tiposMovimiento,
            usuarios: usuariosConMovimientos.map(m => m.usuario)
        });
    } catch (error) {
        console.error('Error al obtener movimientos:', error);
        res.status(500).json({ error: 'Error al obtener movimientos de stock' });
    }
});

// Movimientos de un comercio específico (con mismos filtros)
router.get('/comercio/:id_comercio', authMiddleware, async (req, res) => {
    try {
        const { id_comercio } = req.params;
        const {
            desde,
            hasta,
            id_usuario,
            id_tipo_movimiento,
            id_producto,
            busqueda,
            limit = 50,
            offset = 0
        } = req.query;

        const where = { id_comercio };

        if (desde || hasta) {
            where.fecha_hora = {};
            if (desde) where.fecha_hora.gte = new Date(desde);
            if (hasta) {
                const hastaDate = new Date(hasta);
                hastaDate.setHours(23, 59, 59, 999);
                where.fecha_hora.lte = hastaDate;
            }
        }

        if (id_usuario) where.id_usuario = id_usuario;
        if (id_tipo_movimiento) where.id_tipo_movimiento = parseInt(id_tipo_movimiento);
        if (id_producto) where.id_producto = id_producto;

        if (busqueda) {
            where.OR = [
                { producto: { nombre: { contains: busqueda, mode: 'insensitive' } } },
                { usuario: { nombre: { contains: busqueda, mode: 'insensitive' } } },
                { usuario: { apellido: { contains: busqueda, mode: 'insensitive' } } }
            ];
        }

        const [movimientos, total] = await Promise.all([
            prisma.movimientoStock.findMany({
                where,
                include: {
                    producto: true,
                    usuario: true,
                    tipo_movimiento: true,
                    variantes: {
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
                },
                orderBy: { fecha_hora: 'desc' },
                take: parseInt(limit),
                skip: parseInt(offset)
            }),
            prisma.movimientoStock.count({ where })
        ]);

        res.json({
            data: movimientos,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (error) {
        console.error('Error al obtener movimientos del comercio:', error);
        res.status(500).json({ error: 'Error al obtener movimientos del comercio' });
    }
});

// Crear movimiento de stock (Ingreso, Egreso, Ajuste)
router.post('/', authMiddleware, async (req, res) => {
    try {
        const { id_comercio, id_producto, cantidad_cambio, id_tipo_movimiento } = req.body;
        const id_usuario = req.user.id_usuario;

        // 1. Obtener o crear inventario
        let inventario = await prisma.inventarioComercio.findUnique({
            where: { id_comercio_id_producto: { id_comercio, id_producto } }
        });

        if (!inventario) {
            inventario = await prisma.inventarioComercio.create({
                data: { id_comercio, id_producto, cantidad_actual: 0 }
            });
        }

        const saldo_anterior = inventario.cantidad_actual;
        const saldo_posterior = saldo_anterior + parseInt(cantidad_cambio);

        // 2. Realizar operación en transacción
        const result = await prisma.$transaction(async (tx) => {
            // Actualizar stock
            const updatedInv = await tx.inventarioComercio.update({
                where: { id_inventario: inventario.id_inventario },
                data: { cantidad_actual: saldo_posterior }
            });

            // Registrar movimiento
            const mov = await tx.movimientoStock.create({
                data: {
                    id_comercio,
                    id_producto,
                    id_usuario,
                    id_tipo_movimiento: parseInt(id_tipo_movimiento),
                    cantidad_cambio: parseInt(cantidad_cambio),
                    saldo_anterior,
                    saldo_posterior
                },
                include: { producto: true, comercio: true, tipo_movimiento: true }
            });

            return mov;
        });

        // 3. Notificar a managers
        await notifyCommerceManagers(id_comercio, {
            titulo: 'Actualización de Stock',
            mensaje: `Movimiento de ${cantidad_cambio} unidades registrado para "${result.producto.nombre}" (${result.tipo_movimiento.nombre_movimiento}).`,
            tipo: 'COMMERCE'
        });

        // Si es un ingreso (tipo 1), validar y descontar del stock_central del producto
        if (parseInt(id_tipo_movimiento) === 1) {
            const producto = await prisma.producto.findUnique({
                where: { id_producto },
                select: { stock_central: true, nombre: true }
            });

            const cantidadEnvio = Math.abs(parseInt(cantidad_cambio));
            
            if (!producto || producto.stock_central < cantidadEnvio) {
                return res.status(400).json({ 
                    error: `Stock central insuficiente para "${producto?.nombre || 'producto'}". Disponible: ${producto?.stock_central || 0}, Requerido: ${cantidadEnvio}` 
                });
            }

            await prisma.producto.update({
                where: { id_producto },
                data: {
                    stock_central: {
                        decrement: cantidadEnvio
                    }
                }
            });
        }

        res.status(201).json(result);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al registrar movimiento de stock' });
    }
});

// ═══════════════════════════════════════════════════════════
// ENDPOINT PARA MOVIMIENTOS CON DESGLOSE DE VARIANTES
// ═══════════════════════════════════════════════════════════

// Crear movimiento de stock con desglose por variantes
router.post('/con-variantes', authMiddleware, async (req, res) => {
    try {
        const { id_comercio, id_producto, items_variantes, id_tipo_movimiento } = req.body;
        const id_usuario = req.user.id_usuario;

        // Validar que hay items de variantes
        if (!items_variantes || !Array.isArray(items_variantes) || items_variantes.length === 0) {
            return res.status(400).json({ error: 'Se requieren items de variantes' });
        }

        // Calcular cantidad total
        const cantidad_total = items_variantes.reduce((sum, item) => sum + Math.abs(parseInt(item.cantidad)), 0);

        // 1. Obtener o crear inventario del producto
        let inventario = await prisma.inventarioComercio.findUnique({
            where: { id_comercio_id_producto: { id_comercio, id_producto } }
        });

        if (!inventario) {
            inventario = await prisma.inventarioComercio.create({
                data: { 
                    id_comercio, 
                    id_producto, 
                    cantidad_actual: 0,
                    usa_desglose_variantes: true,
                    comision_pactada_porcentaje: 0
                }
            });
        }

        // Si no tenía desglose de variantes, activarlo
        if (!inventario.usa_desglose_variantes) {
            await prisma.inventarioComercio.update({
                where: { id_inventario: inventario.id_inventario },
                data: { usa_desglose_variantes: true }
            });
        }

        const saldo_anterior = inventario.cantidad_actual;
        const saldo_posterior = saldo_anterior + cantidad_total;

        // 2. Realizar operación en transacción
        const result = await prisma.$transaction(async (tx) => {
            // Actualizar stock total del producto
            const updatedInv = await tx.inventarioComercio.update({
                where: { id_inventario: inventario.id_inventario },
                data: { cantidad_actual: saldo_posterior }
            });

            // Crear movimiento principal con flag de desglose
            const mov = await tx.movimientoStock.create({
                data: {
                    id_comercio,
                    id_producto,
                    id_usuario,
                    id_tipo_movimiento: parseInt(id_tipo_movimiento),
                    cantidad_cambio: cantidad_total,
                    saldo_anterior,
                    saldo_posterior,
                    tiene_desglose_variantes: true
                },
                include: { producto: true, comercio: true, tipo_movimiento: true }
            });

            // Procesar cada variante
            const variantesProcesadas = [];
            for (const item of items_variantes) {
                const { id_variante, cantidad } = item;
                const cantidadNum = parseInt(cantidad);

                // Buscar inventario de variante usando el ID compuesto único
                let invVariante = await tx.inventarioComercioVariante.findUnique({
                    where: {
                        id_inventario_id_variante: {
                            id_inventario: inventario.id_inventario,
                            id_variante: id_variante
                        }
                    }
                });

                // Si no existe, crearlo
                if (!invVariante) {
                    invVariante = await tx.inventarioComercioVariante.create({
                        data: {
                            id_inventario: inventario.id_inventario,
                            id_variante: id_variante,
                            cantidad_actual: 0,
                            stock_minimo_alerta: 5
                        }
                    });
                }

                const saldoVarAnterior = invVariante.cantidad_actual;
                const saldoVarPosterior = saldoVarAnterior + cantidadNum;

                // Actualizar stock de variante
                await tx.inventarioComercioVariante.update({
                    where: { id_inventario_var: invVariante.id_inventario_var },
                    data: { cantidad_actual: saldoVarPosterior }
                });

                // Registrar movimiento de variante
                const movVariante = await tx.movimientoStockVariante.create({
                    data: {
                        id_movimiento: mov.id_movimiento,
                        id_variante: id_variante,
                        cantidad_cambio: cantidadNum,
                        saldo_anterior: saldoVarAnterior,
                        saldo_posterior: saldoVarPosterior
                    }
                });

                // Obtener datos de la variante para la respuesta
                const varianteData = await tx.productoVariante.findUnique({
                    where: { id_variante: id_variante },
                    select: {
                        id_variante: true,
                        sku_variante: true,
                        atributos_valores: true
                    }
                });

                variantesProcesadas.push({
                    ...movVariante,
                    variante: varianteData
                });
            }

            return { movimiento: mov, variantes: variantesProcesadas };
        }, {
            maxWait: 20000,
            timeout: 30000
        });

        // 3. Notificar a managers
        const producto = await prisma.producto.findUnique({
            where: { id_producto },
            select: { nombre: true }
        });

        const tipoMov = await prisma.tipoMovimiento.findUnique({
            where: { id_tipo_movimiento: parseInt(id_tipo_movimiento) }
        });

        await notifyCommerceManagers(id_comercio, {
            titulo: 'Actualización de Stock con Variantes',
            mensaje: `Movimiento de ${cantidad_total} unidades (${items_variantes.length} variantes) registrado para "${producto?.nombre}" (${tipoMov?.nombre_movimiento}).`,
            tipo: 'COMMERCE'
        });

        // 4. Si es ingreso (tipo 1), descontar del stock_central de cada variante
        if (parseInt(id_tipo_movimiento) === 1) {
            for (const item of items_variantes) {
                const { id_variante, cantidad } = item;
                const cantidadNum = Math.abs(parseInt(cantidad));

                const variante = await prisma.productoVariante.findUnique({
                    where: { id_variante },
                    select: { stock_central: true, sku_variante: true }
                });

                if (variante && variante.stock_central >= cantidadNum) {
                    await prisma.productoVariante.update({
                        where: { id_variante },
                        data: { stock_central: { decrement: cantidadNum } }
                    });
                }
            }

            // También descontar del stock_central general del producto
            await prisma.producto.update({
                where: { id_producto },
                data: { stock_central: { decrement: cantidad_total } }
            });
        }

        res.status(201).json({
            message: 'Movimiento registrado correctamente',
            movimiento: result.movimiento,
            variantes: result.variantes,
            cantidad_total,
            cantidad_variantes: items_variantes.length
        });
    } catch (error) {
        console.error('Error en movimiento con variantes:', error);
        res.status(500).json({ 
            error: 'Error al registrar movimiento de stock con variantes',
            details: error.message 
        });
    }
});

module.exports = router;
