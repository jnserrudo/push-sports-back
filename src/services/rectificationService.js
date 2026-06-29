const prisma = require('../config/prisma');
const inventoryService = require('./inventoryService');

const rectificationService = {

  /**
   * Rectifica una venta: anula la original y opcionalmente crea una corregida.
   * Todo dentro de una transacción atómica.
   * Ahora incluye: estado, variantes, tabla Rectificacion, tipos y motivos.
   */
  async rectificarVenta({
    id_venta,
    nuevos_detalles,
    metodo_pago,
    motivo,
    id_usuario,
    id_tipo_rectificacion,
    motivo_libre,
    observaciones,
    es_anulacion_total = false
  }) {
    return await prisma.$transaction(async (tx) => {
      // 1. Obtener venta original con detalles y variantes
      const ventaOriginal = await tx.ventaCabecera.findUnique({
        where: { id_venta },
        include: {
          detalles: {
            include: {
              producto: true,
              variantes: { include: { variante: true } }
            }
          },
          devoluciones: true
        }
      });

      if (!ventaOriginal) throw new Error('Venta no encontrada.');
      if (ventaOriginal.estado !== 'ACTIVA') throw new Error('Solo se pueden rectificar ventas activas.');
      if (ventaOriginal.id_liquidacion) throw new Error('No se puede rectificar una venta que ya fue liquidada.');
      if (ventaOriginal.devoluciones.length > 0) throw new Error('No se puede rectificar una venta que tiene devoluciones procesadas.');

      const id_comercio = ventaOriginal.id_comercio;

      // 2. ANULACIÓN: Revertir stock y saldo por cada detalle original
      let netoOriginalTotal = 0;
      for (const det of ventaOriginal.detalles) {
        const netoItem = parseFloat(det.precio_pushsport_historico) * det.cantidad;
        netoOriginalTotal += netoItem;

        // Revertir stock de variantes si aplica
        if (det.tiene_variantes && det.variantes.length > 0) {
          for (const varDet of det.variantes) {
            const invVar = await tx.inventarioComercioVariante.findFirst({
              where: {
                variante: { id_variante: varDet.id_variante },
                inventario_padre: { id_comercio }
              }
            });
            if (invVar) {
              await tx.inventarioComercioVariante.update({
                where: { id_inventario_var: invVar.id_inventario_var },
                data: { cantidad_actual: { increment: varDet.cantidad } }
              });
            }
            // Stock global también se reintegra
            await inventoryService.updateStock({
              id_comercio,
              id_producto: det.id_producto,
              id_usuario,
              id_tipo_movimiento: 6,
              cantidad_cambio: varDet.cantidad
            }, tx);
          }
        } else {
          await inventoryService.updateStock({
            id_comercio,
            id_producto: det.id_producto,
            id_usuario,
            id_tipo_movimiento: 6,
            cantidad_cambio: det.cantidad
          }, tx);
        }
      }

      // Actualizar estado de venta original
      await tx.ventaCabecera.update({
        where: { id_venta },
        data: {
          estado: es_anulacion_total ? 'ANULADA' : 'RECTIFICADA',
          motivo_rectificacion: motivo
        }
      });

      // Descontar neto del saldo acumulado
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

      // 3. RE-EMISIÓN (si hay nuevos detalles y no es anulación total)
      let nuevaVenta = null;
      if (!es_anulacion_total && nuevos_detalles && nuevos_detalles.length > 0) {
        let totalNuevo = 0;
        let netoNuevoTotal = 0;
        const detallesProcesados = [];

        for (const item of nuevos_detalles) {
          const producto = await tx.producto.findUnique({
            where: { id_producto: item.id_producto },
            select: {
              precio_pushsport: true,
              costo_compra: true,
              activo: true,
              nombre: true,
              usa_variantes: true
            }
          });
          if (!producto || !producto.activo) throw new Error(`Producto ${item.id_producto} no disponible.`);

          const precioUnitario = parseFloat(item.precio_unitario || item.precio_unitario_cobrado || 0);
          const cantidad = parseInt(item.cantidad);
          if (!cantidad || cantidad <= 0) throw new Error(`Cantidad inválida para ${producto.nombre}.`);
          const pPush = parseFloat(producto.precio_pushsport) || 0;
          const subtotal = precioUnitario * cantidad;
          const neto = pPush * cantidad;

          totalNuevo += subtotal;
          netoNuevoTotal += neto;

          const usaVariante = producto.usa_variantes || !!item.id_variante;

          detallesProcesados.push({
            id_producto: item.id_producto,
            id_variante: item.id_variante || null,
            cantidad,
            precio_unitario_cobrado: precioUnitario,
            precio_pushsport_historico: pPush,
            costo_unitario_historico: producto.costo_compra,
            tiene_variantes: usaVariante
          });

          // Validar y descontar stock de variante si aplica
          if (usaVariante && item.id_variante) {
            const invVar = await tx.inventarioComercioVariante.findFirst({
              where: {
                variante: { id_variante: item.id_variante },
                inventario_padre: { id_comercio }
              }
            });
            const stockDisp = invVar?.cantidad_actual || 0;
            if (stockDisp < cantidad) {
              throw new Error(`Stock insuficiente para ${producto.nombre} (variante). Disponible: ${stockDisp}`);
            }
            await tx.inventarioComercioVariante.update({
              where: { id_inventario_var: invVar.id_inventario_var },
              data: { cantidad_actual: { decrement: cantidad } }
            });
            await inventoryService.updateStock({
              id_comercio,
              id_producto: item.id_producto,
              id_usuario,
              id_tipo_movimiento: 2,
              cantidad_cambio: cantidad
            }, tx);
          } else if (usaVariante && !item.id_variante) {
            throw new Error(`El producto ${producto.nombre} requiere especificar una variante.`);
          } else {
            await inventoryService.updateStock({
              id_comercio,
              id_producto: item.id_producto,
              id_usuario,
              id_tipo_movimiento: 2,
              cantidad_cambio: cantidad
            }, tx);
          }
        }

        nuevaVenta = await tx.ventaCabecera.create({
          data: {
            id_comercio,
            id_usuario,
            total_venta: totalNuevo,
            metodo_pago: metodo_pago || ventaOriginal.metodo_pago,
            estado: 'ACTIVA',
            tipo_venta: 'RECTIFICACION',
            id_venta_origen: id_venta,
            motivo_rectificacion: motivo
          }
        });

        for (const det of detallesProcesados) {
          const { id_variante, ...detData } = det;
          const nuevoDetalle = await tx.ventaDetalle.create({
            data: { ...detData, id_venta: nuevaVenta.id_venta }
          });
          if (id_variante) {
            await tx.ventaDetalleVariante.create({
              data: {
                id_detalle: nuevoDetalle.id_detalle,
                id_variante,
                cantidad: det.cantidad,
                precio_unitario: det.precio_unitario_cobrado
              }
            });
          }
        }

        // Incrementar saldo con el nuevo neto
        if (netoNuevoTotal > 0) {
          await tx.comercio.update({
            where: { id_comercio },
            data: { saldo_acumulado_mili: { increment: netoNuevoTotal } }
          });
        }
      }

      // 4. REGISTRAR RECTIFICACION
      const detalleCambios = {
        venta_original: { id_venta, total: Number(ventaOriginal.total_venta), neto: netoOriginalTotal },
        venta_nueva: nuevaVenta ? { id_venta: nuevaVenta.id_venta, total: Number(nuevaVenta.total_venta) } : null,
        anulacion_total: es_anulacion_total,
        detalles_originales: ventaOriginal.detalles.map(d => ({
          id_producto: d.id_producto,
          cantidad: d.cantidad,
          precio_unitario_cobrado: Number(d.precio_unitario_cobrado),
          precio_pushsport_historico: Number(d.precio_pushsport_historico)
        })),
        detalles_nuevos: nuevos_detalles || []
      };

      const rectificacion = await tx.rectificacion.create({
        data: {
          id_venta_origen: id_venta,
          id_venta_nueva: nuevaVenta?.id_venta || null,
          id_usuario,
          id_tipo_rectificacion: id_tipo_rectificacion || null,
          motivo_libre: motivo_libre || null,
          observaciones: observaciones || null,
          detalle_cambios: JSON.stringify(detalleCambios)
        }
      });

      // 5. AUDITORIA
      await tx.auditoriaSistema.create({
        data: {
          id_usuario,
          entidad_afectada: 'Venta',
          id_entidad_afectada: id_venta,
          accion: es_anulacion_total ? 'ANULACION' : 'RECTIFICACION',
          descripcion_accion: es_anulacion_total
            ? `Venta ${id_venta} anulada. Motivo: ${motivo}`
            : `Venta ${id_venta} rectificada. Nueva venta: ${nuevaVenta?.id_venta}. Motivo: ${motivo}`,
          datos_anteriores: JSON.stringify({ estado: 'ACTIVA', total: Number(ventaOriginal.total_venta) }),
          datos_nuevos: JSON.stringify({
            estado: es_anulacion_total ? 'ANULADA' : 'RECTIFICADA',
            id_venta_nueva: nuevaVenta?.id_venta || null,
            id_rectificacion: rectificacion.id_rectificacion
          }),
          id_comercio,
          id_venta
        }
      });

      return {
        venta_original: { id_venta, estado: es_anulacion_total ? 'ANULADA' : 'RECTIFICADA' },
        venta_nueva: nuevaVenta,
        id_rectificacion: rectificacion.id_rectificacion
      };
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
  },

  // ─── TIPOS Y MOTIVOS DE RECTIFICACIÓN ─────────────────────────────────────

  async getTiposRectificacion() {
    return await prisma.tipoRectificacion.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    });
  },

  async getVentasParaRectificar(user) {
    const isGlobal = user.id_rol === 1 || (user.id_rol === 2 && !user.id_comercio_asignado);
    const where = isGlobal ? {} : { id_comercio: user.id_comercio_asignado };
    
    const ventas = await prisma.ventaCabecera.findMany({
      where: {
        ...where,
        estado: 'ACTIVA',
        id_liquidacion: null
      },
      include: {
        comercio: {
          select: {
            nombre: true
          }
        },
        detalles: {
          include: {
            producto: true,
            variantes: {
              include: {
                variante: true
              }
            }
          }
        },
        usuario: {
          select: {
            nombre: true,
            apellido: true
          }
        }
      },
      orderBy: { fecha_hora: 'desc' }
    });

    // Agregar conteo de rectificaciones para cada venta
    for (const venta of ventas) {
      const rectificacionesCount = await prisma.rectificacion.count({
        where: { id_venta_origen: venta.id_venta }
      });
      venta._rectificacionesCount = rectificacionesCount;
    }

    return ventas;
  },

  async getHistorialVenta(id_venta) {
    return await prisma.rectificacion.findMany({
      where: { id_venta_origen: id_venta },
      include: {
        venta_nueva: {
          include: {
            detalles: { include: { producto: true, variantes: { include: { variante: true } } } }
          }
        },
        tipo_rectificacion: true,
        usuario: { select: { nombre: true, apellido: true } }
      },
      orderBy: { fecha: 'desc' }
    });
  },

  async getCadenaVentas(id_venta) {
    const cadena = [];
    let actual = await prisma.ventaCabecera.findUnique({
      where: { id_venta },
      include: {
        comercio: { select: { nombre: true } },
        detalles: { include: { producto: true, variantes: { include: { variante: true } } } },
        usuario: { select: { nombre: true, apellido: true } }
      }
    });
    if (!actual) return cadena;

    // Subir hasta la venta raíz
    while (actual.id_venta_origen) {
      const padre = await prisma.ventaCabecera.findUnique({
        where: { id_venta: actual.id_venta_origen },
        include: {
          comercio: { select: { nombre: true } },
          detalles: { include: { producto: true, variantes: { include: { variante: true } } } },
          usuario: { select: { nombre: true, apellido: true } }
        }
      });
      if (!padre) break;
      actual = padre;
    }

    // Bajar por la cadena de rectificaciones
    let nodo = actual;
    while (nodo) {
      // Obtener rectificación asociada a esta venta (si es que fue rectificada)
      const rectificacion = await prisma.rectificacion.findFirst({
        where: { id_venta_origen: nodo.id_venta },
        include: {
          tipo_rectificacion: true,
          usuario: { select: { nombre: true, apellido: true } }
        }
      });

      cadena.push({
        ...nodo,
        _rectificacion: rectificacion
      });

      const hijo = await prisma.ventaCabecera.findFirst({
        where: { id_venta_origen: nodo.id_venta, tipo_venta: 'RECTIFICACION' },
        include: {
          comercio: { select: { nombre: true } },
          detalles: { include: { producto: true, variantes: { include: { variante: true } } } },
          usuario: { select: { nombre: true, apellido: true } }
        },
        orderBy: { fecha_hora: 'desc' }
      });
      nodo = hijo;
    }

    return cadena;
  },

  // ─── SEED INICIAL DE TIPOS Y MOTIVOS ───────────────────────────────────────

  async seedTiposYMotivos() {
    const tipos = [
      {
        codigo: 'ERROR_PRECIO',
        nombre: 'Error de precio',
        descripcion: 'El precio cargado en la venta era incorrecto.',
        es_otro: false
      },
      {
        codigo: 'CANTIDAD_INCORRECTA',
        nombre: 'Cantidad incorrecta',
        descripcion: 'Se vendió una cantidad diferente a la deseada.',
        es_otro: false
      },
      {
        codigo: 'PRODUCTO_EQUIVOCADO',
        nombre: 'Producto equivocado',
        descripcion: 'Se cargó un producto distinto al que el cliente quería.',
        es_otro: false
      },
      {
        codigo: 'DEVOLUCION_TOTAL',
        nombre: 'Devolución total',
        descripcion: 'El cliente devuelve toda la venta.',
        es_otro: false
      },
      {
        codigo: 'ANULACION_CLIENTE',
        nombre: 'Anulación por cliente',
        descripcion: 'El cliente cancela la compra.',
        es_otro: false
      },
      {
        codigo: 'OTROS',
        nombre: 'Otros',
        descripcion: 'Otro motivo no listado (requiere detalle).',
        es_otro: true
      }
    ];

    for (const tipoData of tipos) {
      await prisma.tipoRectificacion.upsert({
        where: { codigo: tipoData.codigo },
        update: {},
        create: tipoData
      });
    }

    return { message: 'Tipos de rectificación inicializados.' };
  }
};

module.exports = rectificationService;
