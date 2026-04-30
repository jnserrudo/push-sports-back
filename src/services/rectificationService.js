const prisma = require('../config/prisma');
const inventoryService = require('./inventoryService');

const rectificationService = {

  /**
   * Rectifica una venta: anula la original y opcionalmente crea una corregida.
   * Todo dentro de una transacción atómica.
   */
  async rectificarVenta({ id_venta, nuevos_detalles, metodo_pago, motivo, id_usuario }) {
    return await prisma.$transaction(async (tx) => {
      // 1. Obtener venta original con detalles
      const ventaOriginal = await tx.ventaCabecera.findUnique({
        where: { id_venta },
        include: { detalles: { include: { producto: true } }, devoluciones: true }
      });

      if (!ventaOriginal) throw new Error('Venta no encontrada.');
      if (ventaOriginal.tipo_venta !== 'VENTA') throw new Error('Solo se pueden rectificar ventas originales (no anulaciones ni rectificaciones).');
      if (ventaOriginal.id_liquidacion) throw new Error('No se puede rectificar una venta que ya fue liquidada.');
      if (ventaOriginal.devoluciones.length > 0) throw new Error('No se puede rectificar una venta que tiene devoluciones procesadas. Revierta las devoluciones primero.');

      const id_comercio = ventaOriginal.id_comercio;

      // 2. ANULACIÓN: Revertir stock y saldo por cada detalle original
      let netoOriginalTotal = 0;
      for (const det of ventaOriginal.detalles) {
        const netoItem = parseFloat(det.precio_pushsport_historico) * det.cantidad;
        netoOriginalTotal += netoItem;

        // Devolver stock (tipo 6 = Rectificación Venta Ingreso)
        await inventoryService.updateStock({
          id_comercio,
          id_producto: det.id_producto,
          id_usuario,
          id_tipo_movimiento: 6,
          cantidad_cambio: det.cantidad // positivo = ingreso
        }, tx);
      }

      // Crear registro de anulación (monto negativo para trazabilidad)
      const anulacion = await tx.ventaCabecera.create({
        data: {
          id_comercio,
          id_usuario,
          total_venta: -Number(ventaOriginal.total_venta),
          metodo_pago: ventaOriginal.metodo_pago,
          tipo_venta: 'ANULACION',
          id_venta_origen: id_venta,
          motivo_rectificacion: motivo
        }
      });

      // Crear detalles espejo negativos
      for (const det of ventaOriginal.detalles) {
        await tx.ventaDetalle.create({
          data: {
            id_venta: anulacion.id_venta,
            id_producto: det.id_producto,
            cantidad: -det.cantidad,
            precio_unitario_cobrado: det.precio_unitario_cobrado,
            precio_pushsport_historico: det.precio_pushsport_historico,
            costo_unitario_historico: det.costo_unitario_historico,
            tiene_variantes: det.tiene_variantes
          }
        });
      }

      // Descontar neto del saldo
      if (netoOriginalTotal > 0) {
        const comercio = await tx.comercio.findUnique({
          where: { id_comercio },
          select: { saldo_acumulado_mili: true }
        });
        const saldoActual = Number(comercio?.saldo_acumulado_mili || 0);
        await tx.comercio.update({
          where: { id_comercio },
          data: { saldo_acumulado_mili: Math.max(0, saldoActual - netoOriginalTotal) }
        });
      }

      // 3. RE-EMISIÓN (si hay nuevos detalles)
      let nuevaVenta = null;
      if (nuevos_detalles && nuevos_detalles.length > 0) {
        let totalNuevo = 0;
        let netoNuevoTotal = 0;
        const detallesProcesados = [];

        for (const item of nuevos_detalles) {
          const producto = await tx.producto.findUnique({
            where: { id_producto: item.id_producto },
            select: { precio_pushsport: true, costo_compra: true, activo: true, nombre: true }
          });
          if (!producto || !producto.activo) throw new Error(`Producto ${item.id_producto} no disponible.`);

          const precioUnitario = parseFloat(item.precio_unitario || item.precio_unitario_cobrado);
          const cantidad = parseInt(item.cantidad);
          const pPush = parseFloat(producto.precio_pushsport) || 0;
          const subtotal = precioUnitario * cantidad;
          const neto = pPush * cantidad;

          totalNuevo += subtotal;
          netoNuevoTotal += neto;

          detallesProcesados.push({
            id_producto: item.id_producto,
            cantidad,
            precio_unitario_cobrado: precioUnitario,
            precio_pushsport_historico: pPush,
            costo_unitario_historico: producto.costo_compra,
            tiene_variantes: false
          });

          // Descontar stock (tipo 2 = Venta)
          await inventoryService.updateStock({
            id_comercio,
            id_producto: item.id_producto,
            id_usuario,
            id_tipo_movimiento: 2,
            cantidad_cambio: cantidad
          }, tx);
        }

        nuevaVenta = await tx.ventaCabecera.create({
          data: {
            id_comercio,
            id_usuario,
            total_venta: totalNuevo,
            metodo_pago: metodo_pago || ventaOriginal.metodo_pago,
            tipo_venta: 'RECTIFICACION',
            id_venta_origen: id_venta,
            motivo_rectificacion: motivo
          }
        });

        for (const det of detallesProcesados) {
          await tx.ventaDetalle.create({
            data: { ...det, id_venta: nuevaVenta.id_venta }
          });
        }

        // Incrementar saldo con el nuevo neto
        if (netoNuevoTotal > 0) {
          await tx.comercio.update({
            where: { id_comercio },
            data: { saldo_acumulado_mili: { increment: netoNuevoTotal } }
          });
        }
      }

      return { anulacion, nuevaVenta, ventaOriginal: { id_venta, total_venta: ventaOriginal.total_venta } };
    }, { maxWait: 20000, timeout: 30000 });
  },

  /**
   * Rectifica un movimiento de stock.
   */
  async rectificarMovimiento({ id_movimiento, nuevos_items, motivo, id_usuario }) {
    return await prisma.$transaction(async (tx) => {
      const movOriginal = await tx.movimientoStock.findUnique({
        where: { id_movimiento },
        include: { producto: true }
      });

      if (!movOriginal) throw new Error('Movimiento no encontrado.');
      if (movOriginal.id_movimiento_origen) throw new Error('No se puede rectificar un movimiento que ya es una rectificación.');

      const id_comercio = movOriginal.id_comercio;
      const id_producto = movOriginal.id_producto;

      // Revertir: crear movimiento espejo
      const inventario = await tx.inventarioComercio.findUnique({
        where: { id_comercio_id_producto: { id_comercio, id_producto } }
      });
      const saldoActual = inventario?.cantidad_actual || 0;
      const cantidadReversion = -movOriginal.cantidad_cambio;
      const saldoPosterior = saldoActual + cantidadReversion;

      await tx.inventarioComercio.update({
        where: { id_inventario: inventario.id_inventario },
        data: { cantidad_actual: saldoPosterior }
      });

      const movReversion = await tx.movimientoStock.create({
        data: {
          id_producto,
          id_comercio,
          id_usuario,
          id_tipo_movimiento: movOriginal.cantidad_cambio > 0 ? 7 : 6,
          cantidad_cambio: cantidadReversion,
          saldo_anterior: saldoActual,
          saldo_posterior: saldoPosterior,
          id_movimiento_origen: id_movimiento,
          motivo_rectificacion: motivo
        }
      });

      // Re-emitir con datos corregidos (si hay)
      let movNuevo = null;
      if (nuevos_items && nuevos_items.length > 0) {
        const item = nuevos_items[0]; // Un movimiento = un producto
        const cantNueva = parseInt(item.cantidad_cambio);
        const invActual = await tx.inventarioComercio.findUnique({
          where: { id_comercio_id_producto: { id_comercio, id_producto: item.id_producto || id_producto } }
        });
        const sAct = invActual?.cantidad_actual || 0;
        const sPost = sAct + cantNueva;

        await tx.inventarioComercio.update({
          where: { id_inventario: invActual.id_inventario },
          data: { cantidad_actual: sPost }
        });

        movNuevo = await tx.movimientoStock.create({
          data: {
            id_producto: item.id_producto || id_producto,
            id_comercio,
            id_usuario,
            id_tipo_movimiento: movOriginal.id_tipo_movimiento,
            cantidad_cambio: cantNueva,
            saldo_anterior: sAct,
            saldo_posterior: sPost,
            id_movimiento_origen: id_movimiento,
            motivo_rectificacion: motivo
          }
        });
      }

      return { movReversion, movNuevo };
    }, { maxWait: 20000, timeout: 30000 });
  },

  /**
   * Crea una solicitud de rectificación (para vendedores).
   */
  async crearSolicitud({ tipo_entidad, id_entidad, id_comercio, id_solicitante, motivo, datos_corregidos }) {
    return await prisma.solicitudRectificacion.create({
      data: {
        tipo_entidad,
        id_entidad,
        id_comercio,
        id_solicitante,
        motivo,
        datos_corregidos: datos_corregidos ? JSON.stringify(datos_corregidos) : null
      }
    });
  },

  async aprobarSolicitud({ id_solicitud, id_aprobador }) {
    const solicitud = await prisma.solicitudRectificacion.findUnique({ where: { id_solicitud } });
    if (!solicitud) throw new Error('Solicitud no encontrada.');
    if (solicitud.estado !== 'PENDIENTE') throw new Error('La solicitud ya fue resuelta.');

    // Actualizar estado
    const actualizada = await prisma.solicitudRectificacion.update({
      where: { id_solicitud },
      data: { estado: 'APROBADA', id_aprobador, fecha_resolucion: new Date() }
    });

    // Ejecutar la rectificación automáticamente
    const datosCorregidos = solicitud.datos_corregidos ? JSON.parse(solicitud.datos_corregidos) : null;

    if (solicitud.tipo_entidad === 'VENTA') {
      const resultado = await this.rectificarVenta({
        id_venta: solicitud.id_entidad,
        nuevos_detalles: datosCorregidos?.nuevos_detalles || null,
        metodo_pago: datosCorregidos?.metodo_pago || null,
        motivo: solicitud.motivo,
        id_usuario: id_aprobador
      });
      return { solicitud: actualizada, resultado };
    } else if (solicitud.tipo_entidad === 'MOVIMIENTO_STOCK') {
      const resultado = await this.rectificarMovimiento({
        id_movimiento: solicitud.id_entidad,
        nuevos_items: datosCorregidos?.nuevos_items || null,
        motivo: solicitud.motivo,
        id_usuario: id_aprobador
      });
      return { solicitud: actualizada, resultado };
    }

    return { solicitud: actualizada };
  },

  async rechazarSolicitud({ id_solicitud, id_aprobador, motivo_rechazo }) {
    if (!motivo_rechazo) throw new Error('El motivo de rechazo es obligatorio.');
    
    const solicitud = await prisma.solicitudRectificacion.findUnique({ where: { id_solicitud } });
    if (!solicitud) throw new Error('Solicitud no encontrada.');
    if (solicitud.estado !== 'PENDIENTE') throw new Error('La solicitud ya fue resuelta.');

    return await prisma.solicitudRectificacion.update({
      where: { id_solicitud },
      data: { estado: 'RECHAZADA', id_aprobador, fecha_resolucion: new Date(), motivo_rechazo }
    });
  },

  async getPendientes(id_comercio = null) {
    const where = { estado: 'PENDIENTE' };
    if (id_comercio) where.id_comercio = id_comercio;
    return await prisma.solicitudRectificacion.findMany({
      where,
      orderBy: { fecha_solicitud: 'desc' }
    });
  },

  async getHistorial(id_comercio = null) {
    const where = {};
    if (id_comercio) where.id_comercio = id_comercio;
    return await prisma.solicitudRectificacion.findMany({
      where,
      orderBy: { fecha_solicitud: 'desc' }
    });
  }
};

module.exports = rectificationService;
