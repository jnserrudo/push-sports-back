const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const inventoryService = require('../services/inventoryService');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');
const { notifyCommerceManagers } = require('../services/notificationService');

// Endpoint para registrar una venta con múltiples productos
router.post('/', authMiddleware, roleMiddleware([1, 2, 3]), async (req, res) => {
    try {
        const { id_comercio, detalles, metodo_pago } = req.body;
        const id_usuario = req.user.id_usuario; // Usar ID del token

        // 1. Validar que el usuario tenga permiso para vender en este comercio
        // Role 1 (SuperAdmin) puede vender en cualquiera. Roles 2 y 3 solo en el suyo.
        if (req.user.id_rol !== 1 && req.user.id_comercio_asignado !== id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para registrar ventas en este comercio.' });
        }

        if (!id_comercio || !metodo_pago || !Array.isArray(detalles) || detalles.length === 0) {
            return res.status(400).json({ error: 'Faltan datos requeridos o detalles inválidos.' });
        }

        // Variable para acumular el total de la cabecera
        let total_venta_cabecera = 0;
        
        // 2. Pre-validar stock de todos los productos y preparar cálculos
        const detallesProcesados = [];

        for (const item of detalles) {
             const { id_producto, id_variante, cantidad, precio_unitario } = item;

             if (!id_producto || cantidad <= 0 || !precio_unitario) {
                  return res.status(400).json({ error: 'Detalle de formato inválido.' });
             }

             const producto = await prisma.producto.findUnique({
                 where: { id_producto },
                 select: { 
                     id_producto: true, 
                     nombre: true, 
                     activo: true,
                     usa_variantes: true,
                     precio_pushsport: true,
                     costo_compra: true
                 }
             });

             if (!producto || !producto.activo) {
                  return res.status(404).json({ error: `Producto ${id_producto} no disponible.` });
             }

             // Si el producto usa variantes, validar stock de la variante
             if (producto.usa_variantes) {
                 if (!id_variante) {
                     return res.status(400).json({ 
                         error: `El producto "${producto.nombre}" requiere especificar una variante.` 
                     });
                 }

                 const inventarioVariante = await prisma.inventarioComercioVariante.findFirst({
                     where: { 
                         variante: { id_variante },
                         inventario_padre: { id_comercio }
                     },
                     include: { variante: true }
                 });

                 const stockDisponible = inventarioVariante?.cantidad_actual || 0;
                 
                 if (stockDisponible < cantidad) {
                     const atributos = inventarioVariante?.variante?.atributos_valores || {};
                     const nombreVariante = Object.values(atributos).join(' / ') || 'Variante';
                     return res.status(400).json({ 
                         error: `Stock insuficiente para ${producto.nombre} - ${nombreVariante}. Disponible: ${stockDisponible}` 
                     });
                 }
             } else {
                 // Producto sin variantes - comportamiento original
                 const inventario = await prisma.inventarioComercio.findUnique({
                      where: { id_comercio_id_producto: { id_comercio, id_producto } }
                 });

                 if (!inventario || inventario.cantidad_actual < cantidad) {
                     const stockDisp = inventario?.cantidad_actual || 0;
                     return res.status(400).json({ 
                         error: `Stock insuficiente para ${producto.nombre}. Disponible: ${stockDisp}` 
                     });
                 }
             }

             const subtotal = parseFloat(precio_unitario) * cantidad;
             
             // Nueva lógica: La sede central (Mili) cobra el PRECIO PUSH SPORT.
             // La ganancia del comercio es la diferencia entre el precio de venta y el pushsport.
             const pPushsport = parseFloat(producto.precio_pushsport) || 0;
             const neto = pPushsport * cantidad; // Lo que Mili recibe
             const comision_monto = subtotal - neto; // La ganancia de la sucursal
             
             const costo_unitario_historico = producto.costo_compra;

             total_venta_cabecera += subtotal;

             detallesProcesados.push({
                 id_producto,
                 id_variante, // puede ser null
                 cantidad,
                 precio_unitario_cobrado: precio_unitario,
                 precio_pushsport_historico: pPushsport,
                 costo_unitario_historico,
                 _neto: neto,
                 usa_variantes: producto.usa_variantes
             });
        }

        // 3. Iniciar transacción principal para cabecera, detalles y stock
        const result = await prisma.$transaction(async (tx) => {
             // 3a. Crear Cabecera
             const nuevaVenta = await tx.ventaCabecera.create({
                 data: {
                     id_comercio,
                     id_usuario,
                     total_venta: total_venta_cabecera,
                     metodo_pago
                 }
             });

             // 3b. Insertar Detalles
             const detailsWithVentaId = detallesProcesados.map(d => ({
                 id_producto: d.id_producto,
                 cantidad: d.cantidad,
                 precio_unitario_cobrado: d.precio_unitario_cobrado,
                 precio_pushsport_historico: d.precio_pushsport_historico,
                 costo_unitario_historico: d.costo_unitario_historico,
                 id_venta: nuevaVenta.id_venta,
                 tiene_variantes: d.usa_variantes
             }));

             await tx.ventaDetalle.createMany({
                 data: detailsWithVentaId
             });

             // Si hay variantes, crear los registros de VentaDetalleVariante
             const detallesConVariantes = detallesProcesados.filter(d => d.usa_variantes && d.id_variante);
             if (detallesConVariantes.length > 0) {
                 // Obtener los IDs de los detalles recién creados
                 const detallesCreados = await tx.ventaDetalle.findMany({
                     where: { id_venta: nuevaVenta.id_venta },
                     select: { id_detalle: true, id_producto: true }
                 });

                 const variantesData = detallesConVariantes.map(d => {
                     const detallePadre = detallesCreados.find(dc => dc.id_producto === d.id_producto);
                     return {
                         id_detalle: detallePadre.id_detalle,
                         id_variante: d.id_variante,
                         cantidad: d.cantidad,
                         precio_unitario: d.precio_unitario_cobrado
                     };
                 });

                 await tx.ventaDetalleVariante.createMany({
                     data: variantesData
                 });
             }

             // 3c. Actualizar Stock y registrar Movimientos (Kardex)
             // tipo_movimiento: 2 = "Venta" (factor_multiplicador: -1)
             let totalNeto = 0;
             for (const det of detallesProcesados) {
                 if (det.usa_variantes && det.id_variante) {
                     // Actualizar stock de variante
                     const inventarioVariante = await tx.inventarioComercioVariante.findFirst({
                         where: { 
                             variante: { id_variante: det.id_variante },
                             inventario_padre: { id_comercio }
                         }
                     });

                     if (inventarioVariante) {
                         await tx.inventarioComercioVariante.update({
                             where: { id_inventario_var: inventarioVariante.id_inventario_var },
                             data: {
                                 cantidad_actual: { decrement: det.cantidad }
                             }
                         });

                         // Registrar movimiento de variante
                         await tx.movimientoStockVariante.create({
                             data: {
                                 id_movimiento: (await tx.movimientoStock.create({
                                     data: {
                                         id_producto: det.id_producto,
                                         id_comercio,
                                         id_usuario,
                                         id_tipo_movimiento: 2,
                                         cantidad_cambio: -det.cantidad,
                                         saldo_anterior: inventarioVariante.cantidad_actual,
                                         saldo_posterior: inventarioVariante.cantidad_actual - det.cantidad,
                                         tiene_desglose_variantes: true
                                     },
                                     select: { id_movimiento: true }
                                 })).id_movimiento,
                                 id_variante: det.id_variante,
                                 cantidad_cambio: -det.cantidad,
                                 saldo_anterior: inventarioVariante.cantidad_actual,
                                 saldo_posterior: inventarioVariante.cantidad_actual - det.cantidad
                             }
                         });
                     }
                 } else {
                     // Producto sin variantes - comportamiento original
                     await inventoryService.updateStock({
                         id_comercio,
                         id_producto: det.id_producto,
                         id_usuario,
                         id_tipo_movimiento: 2,
                         cantidad_cambio: det.cantidad
                     }, tx);
                 }
                 totalNeto += parseFloat(det._neto);
             }

             // 3d. Acumular el saldo neto de la venta en el Comercio
             //     Este campo es luego zerado cuando se genera una Liquidacion.
             await tx.comercio.update({
                 where: { id_comercio },
                 data: {
                     saldo_acumulado_mili: {
                         increment: totalNeto
                     }
                 }
             });

             return { ventaCabecera: nuevaVenta, detallesCount: detallesProcesados.length };
        });

        // 4. Notificar al manager
        await notifyCommerceManagers(id_comercio, {
            titulo: 'Nueva Venta Procesada',
            mensaje: `Se ha registrado una venta por AR$ ${total_venta_cabecera.toLocaleString()} (${metodo_pago}).`,
            tipo: 'VENTA'
        });

        res.status(201).json({ message: 'Venta registrada con éxito', data: result });

    } catch (error) {
        console.error('Error al registrar venta:', error);
        res.status(500).json({ error: error.message || 'Error interno al registrar la venta.' });
    }
});

// Obtener una venta por ID (usado por el módulo de Devoluciones)
router.get('/:id', authMiddleware, async (req, res) => {
    try {
        const { id } = req.params;
        const venta = await prisma.ventaCabecera.findUnique({
            where: { id_venta: id },
            include: {
                comercio: true,
                usuario: true,
                detalles: {
                    include: { 
                        producto: true,
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
                    }
                }
            }
        });
        if (!venta) return res.status(404).json({ error: 'Venta no encontrada' });

        // Roles 2 y 3 solo pueden ver ventas de su comercio
        if (req.user.id_rol !== 1 && req.user.id_comercio_asignado !== venta.id_comercio) {
            return res.status(403).json({ error: 'No tienes permiso para ver esta venta' });
        }

        res.json(venta);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener la venta' });
    }
});

// Historial de ventas
router.get('/', authMiddleware, async (req, res) => {
    try {
        // SUPER_ADMIN (1) ve todo. Supervisor (2) y Vendedor (3) solo su comercio.
        const filter = (req.user.id_rol === 1) ? {} : { id_comercio: req.user.id_comercio_asignado };

        const ventas = await prisma.ventaCabecera.findMany({
            where: filter,
            include: { 
                 comercio: true,
                 usuario: true,
                 detalles: {
                      include: { 
                          producto: true,
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
                      }
                 }
            },
            orderBy: { fecha_hora: 'desc' }
        });
        res.json(ventas);
    } catch(err) {
        console.error(err);
        res.status(500).json({error: "Error fetching sales"});
    }
});

module.exports = router;
