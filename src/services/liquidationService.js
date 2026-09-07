const prisma = require('../config/prisma');

const liquidationService = {
  /**
   * Preview: obtiene un resumen de todo lo pendiente de liquidar para un comercio.
   * Incluye: ventas pendientes, desglose por método de pago, devoluciones y neto.
   * Si se pasa id_ventas, solo considera esas ventas (deben estar pendientes).
   */
  async getPreviewData(id_comercio, id_ventas = null) {
    // 1. Ventas pendientes (sin liquidar y activas)
    const whereBase = {
      id_comercio,
      id_liquidacion: null,
      estado: 'ACTIVA'
    };
    if (id_ventas && Array.isArray(id_ventas) && id_ventas.length > 0) {
      whereBase.id_venta = { in: id_ventas };
    }

    const ventasPendientes = await prisma.ventaCabecera.findMany({
      where: whereBase,
      include: {
        detalles: {
            include: {
                producto: { select: { nombre: true, usa_variantes: true, precio_pushsport: true, codigo_relacion: { select: { codigo: true } } } },
                variantes: {
                    include: {
                        variante: { select: { id_variante: true, sku_variante: true, atributos_valores: true } }
                    }
                }
            }
        },
        usuario: { select: { nombre: true, apellido: true } }
      },
      orderBy: { fecha_hora: 'asc' }
    });

    const comercio = await prisma.comercio.findUnique({
      where: { id_comercio },
      select: { saldo_acumulado_mili: true, nombre: true, activo: true }
    });
    const saldoAcumulado = Number(comercio?.saldo_acumulado_mili || 0);

    if (ventasPendientes.length === 0) {
      return {
        hayDatos: false,
        saldoHuerfano: saldoAcumulado > 0,
        comercioNombre: comercio?.nombre || '',
        comercioActivo: comercio?.activo !== false,
        cantVentas: 0,
        totalVentasBruto: 0,
        totalVentasNeto: 0,
        saldoAcumulado,
        totalDevoluciones: 0,
        netoFinal: 0,
        desgloseMetodoPago: {},
        resumenProductos: [],
        rangoFechas: null,
        ventas: []
      };
    }

    // 2. Calcular totales y desglose por método de pago
    let totalVentasBruto = 0;
    let totalVentasNeto = 0;
    const desgloseMetodoPago = {};

    for (const venta of ventasPendientes) {
      totalVentasBruto += Number(venta.total_venta);

      // Agrupar por método de pago
      const metodo = venta.metodo_pago || 'Sin especificar';
      if (!desgloseMetodoPago[metodo]) {
        desgloseMetodoPago[metodo] = { bruto: 0, neto: 0, cantidad: 0 };
      }
      desgloseMetodoPago[metodo].cantidad += 1;
      desgloseMetodoPago[metodo].bruto += Number(venta.total_venta);

      // Neto = suma de precio_pushsport_historico * cantidad de cada detalle
      for (const detalle of venta.detalles) {
        const netoDetalle = parseFloat(detalle.precio_pushsport_historico) * detalle.cantidad;
        totalVentasNeto += netoDetalle;
        desgloseMetodoPago[metodo].neto += netoDetalle;
      }
    }

    // 2.5 Generar desglose de productos
    const desgloseMap = {};
    for (const venta of ventasPendientes) {
      for (const detalle of venta.detalles) {
        let nombre = detalle.producto?.nombre || 'Producto Desconocido';
        let codigo = detalle.producto?.codigo_relacion?.codigo || '';
        
        // Agregar info de variante — verificar datos reales en lugar del flag
        if (detalle.variantes && detalle.variantes.length > 0) {
          const varRel = detalle.variantes[0];
          const varDef = varRel.variante;
          
          if (varDef) {
             let atributos = varDef.atributos_valores || {};
             if (typeof atributos === 'string') {
               try { atributos = JSON.parse(atributos); } catch(e) { atributos = {}; }
             }
             
             // Crear string descriptivo: "Atributo1: Valor1 | Atributo2: Valor2"
             const partes = Object.entries(atributos).map(([key, val]) => `${key}: ${val}`);
             const descVariante = partes.length > 0 ? partes.join(' | ') : (varDef.sku_variante || 'Variante');
             
             nombre = `${nombre} (${descVariante})`;
          }
        }

        if (!desgloseMap[nombre]) {
          desgloseMap[nombre] = { 
            nombre, 
            codigo,
            cantidad: 0, 
            total_bruto: 0, 
            total_neto: 0,
            precio_unitario_publico: parseFloat(detalle.precio_unitario_cobrado) || 0,
            precio_unitario_push: parseFloat(detalle.precio_pushsport_historico) || 0,
            precio_unitario_push_actual: parseFloat(detalle.producto?.precio_pushsport) || 0
          };
        }
        desgloseMap[nombre].cantidad += detalle.cantidad;
        desgloseMap[nombre].total_bruto += parseFloat(detalle.precio_unitario_cobrado) * detalle.cantidad;
        desgloseMap[nombre].total_neto += parseFloat(detalle.precio_pushsport_historico) * detalle.cantidad;
      }
    }
    const resumenProductos = Object.values(desgloseMap).sort((a, b) => b.total_bruto - a.total_bruto);

    // 3. Devoluciones de ventas pendientes (no liquidadas)
    const ventasIds = ventasPendientes.map(v => v.id_venta);
    const devoluciones = await prisma.devolucion.findMany({
      where: {
        id_venta: { in: ventasIds }
      },
      include: {
        producto: { select: { nombre: true } }
      }
    });

    const totalDevoluciones = devoluciones.reduce((acc, d) => {
      return acc + Number(d.monto_reembolso || 0);
    }, 0);

    // Neto de devoluciones (lo que ya se descontó del saldo)
    // Ya no necesitamos restar porque el saldo ya refleja las devoluciones en tiempo real

    // 4. Rango de fechas
    const fechaDesde = ventasPendientes[0].fecha_hora;
    const fechaHasta = ventasPendientes[ventasPendientes.length - 1].fecha_hora;

    return {
      hayDatos: true,
      saldoHuerfano: false,
      comercioNombre: comercio?.nombre || '',
      comercioActivo: comercio?.activo !== false,
      cantVentas: ventasPendientes.length,
      totalVentasBruto: Math.round(totalVentasBruto * 100) / 100,
      totalVentasNeto: Math.round(totalVentasNeto * 100) / 100,
      saldoAcumulado,
      totalDevoluciones: Math.round(totalDevoluciones * 100) / 100,
      cantDevoluciones: devoluciones.length,
      netoFinal: Math.round(totalVentasNeto * 100) / 100,
      desgloseMetodoPago,
      resumenProductos,
      rangoFechas: {
        desde: fechaDesde,
        hasta: fechaHasta
      },
      ventas: ventasPendientes.map(v => {
        const neto = v.detalles.reduce((acc, d) => acc + (parseFloat(d.precio_pushsport_historico) || 0) * d.cantidad, 0);
        return {
          id_venta: v.id_venta,
          fecha: v.fecha_hora,
          total: Number(v.total_venta),
          neto,
          metodo_pago: v.metodo_pago,
          vendedor: v.usuario ? `${v.usuario.nombre} ${v.usuario.apellido}` : 'N/A',
          cantItems: v.detalles.reduce((a, d) => a + d.cantidad, 0)
        };
      })
    };
  },

  /**
   * Genera una liquidación para un comercio agrupando todas las ventas no liquidadas.
   * Ahora acepta monto_recibido opcional para registrar diferencias.
   * Si se pasa id_ventas, solo liquidar esas ventas activas y no liquidadas.
   */
  async generateLiquidation({ id_comercio, monto_recibido, observacion, id_usuario, id_ventas = null, descuento_comercial = 0 }) {
    // Prevenir timeouts largos y optimizar la auditoría fijando el usuario
    if (id_usuario) {
      const { setAuditUser } = require('./auditService');
      setAuditUser(id_usuario);
    }

    return await prisma.$transaction(async (tx) => {
      // 1. Buscar ventas a liquidar
      const whereBase = {
        id_comercio,
        id_liquidacion: null,
        estado: 'ACTIVA'
      };
      if (id_ventas && Array.isArray(id_ventas) && id_ventas.length > 0) {
        whereBase.id_venta = { in: id_ventas };
      }

      const ventasPendientes = await tx.ventaCabecera.findMany({
        where: whereBase,
        include: {
          detalles: {
              include: {
                  producto: { select: { nombre: true, usa_variantes: true, precio_pushsport: true, codigo_relacion: { select: { codigo: true } } } },
                  variantes: {
                      include: {
                          variante: { select: { id_variante: true, sku_variante: true, atributos_valores: true } }
                      }
                  }
              }
          }
        }
      });

      if (ventasPendientes.length === 0) {
        throw new Error('No hay ventas pendientes para liquidar en este comercio.');
      }

      // Validar que todas las ventas seleccionadas estén activas y no liquidadas
      for (const v of ventasPendientes) {
        if (v.estado !== 'ACTIVA') throw new Error(`La venta ${v.id_venta} no está activa y no puede liquidarse.`);
        if (v.id_liquidacion) throw new Error(`La venta ${v.id_venta} ya fue liquidada.`);
      }

      // 2. Calcular los totales
      let totalVentasNetas = 0;
      let totalVentasBruto = 0;
      const desgloseMetodoPago = {};

      for (const venta of ventasPendientes) {
        totalVentasBruto += Number(venta.total_venta);
        const metodo = venta.metodo_pago || 'Sin especificar';
        if (!desgloseMetodoPago[metodo]) desgloseMetodoPago[metodo] = 0;
        desgloseMetodoPago[metodo] += Number(venta.total_venta);

        for (const detalle of venta.detalles) {
          totalVentasNetas += parseFloat(detalle.precio_pushsport_historico) * detalle.cantidad;
        }
      }

      // 2.5 Generar desglose de productos para la metadata
      const desgloseMap = {};
      for (const venta of ventasPendientes) {
        for (const detalle of venta.detalles) {
          let nombre = detalle.producto?.nombre || 'Producto Desconocido';
          let codigo = detalle.producto?.codigo_relacion?.codigo || '';
          
          if (detalle.variantes && detalle.variantes.length > 0) {
            const varRel = detalle.variantes[0];
            const varDef = varRel.variante;
            
            if (varDef) {
               let atributos = varDef.atributos_valores || {};
               if (typeof atributos === 'string') {
                 try { atributos = JSON.parse(atributos); } catch(e) { atributos = {}; }
               }
               
               const partes = Object.entries(atributos).map(([key, val]) => `${key}: ${val}`);
               const descVariante = partes.length > 0 ? partes.join(' | ') : (varDef.sku_variante || 'Variante');
               
               nombre = `${nombre} (${descVariante})`;
            }
          }

          if (!desgloseMap[nombre]) {
            desgloseMap[nombre] = { 
              nombre, 
              codigo,
              cantidad: 0, 
              total_bruto: 0, 
              total_neto: 0,
              precio_unitario_publico: parseFloat(detalle.precio_unitario_cobrado) || 0,
              precio_unitario_push: parseFloat(detalle.precio_pushsport_historico) || 0,
              precio_unitario_push_actual: parseFloat(detalle.producto?.precio_pushsport) || 0
            };
          }
          desgloseMap[nombre].cantidad += detalle.cantidad;
          desgloseMap[nombre].total_bruto += parseFloat(detalle.precio_unitario_cobrado) * detalle.cantidad;
          desgloseMap[nombre].total_neto += parseFloat(detalle.precio_pushsport_historico) * detalle.cantidad;
        }
      }
      const resumenProductos = Object.values(desgloseMap).sort((a, b) => b.total_bruto - a.total_bruto);

      // 3. Obtener saldo real del comercio (ya tiene devoluciones descontadas en tiempo real)
      const comercio = await tx.comercio.findUnique({
        where: { id_comercio },
        select: { saldo_acumulado_mili: true }
      });
      const saldoReal = Number(comercio?.saldo_acumulado_mili || 0);
      const netoSeleccionado = Math.round(totalVentasNetas * 100) / 100;
      const descuento = Math.min(Math.max(0, parseFloat(descuento_comercial) || 0), netoSeleccionado);
      const aCobrar = Math.round((netoSeleccionado - descuento) * 100) / 100;

      // 4. Recibido = plata física. A cobrar = neto de estas ventas menos descuento comercial.
      const montoRecibido = (monto_recibido !== undefined && monto_recibido !== null)
        ? parseFloat(monto_recibido)
        : aCobrar;
      const diferencia = Math.round((montoRecibido - aCobrar) * 100) / 100;

      // 5. Metadata enriquecida para la observación
      const metadata = {
        cant_ventas: ventasPendientes.length,
        total_bruto: Math.round(totalVentasBruto * 100) / 100,
        neto_ventas: netoSeleccionado,
        descuento_comercial: descuento,
        a_cobrar: aCobrar,
        desglose_metodo_pago: desgloseMetodoPago,
        resumen_productos: resumenProductos,
        saldo_al_cerrar: saldoReal,
        monto_recibido_manual: monto_recibido !== undefined && monto_recibido !== null
      };

      const obsText = observacion || 'Liquidación semanal';
      const obsConMetadata = `${obsText} ||META|| ${JSON.stringify(metadata)}`;

      // 6. Crear la Liquidación
      const liquidacion = await tx.liquidacion.create({
        data: {
          id_comercio,
          total_ventas_netas: aCobrar,
          monto_recibido: montoRecibido,
          diferencia: Math.round(diferencia * 100) / 100,
          observacion: obsConMetadata,
          estado: 'CERRADA',
        },
      });

      // 7. Actualizar todas las ventas liquidadas
      const ventasIds = ventasPendientes.map(v => v.id_venta);
      await tx.ventaCabecera.updateMany({
        where: { id_venta: { in: ventasIds } },
        data: {
          id_liquidacion: liquidacion.id_liquidacion,
          estado: 'LIQUIDADA'
        },
      });

      // 8. Restar solo el neto de las ventas liquidadas (no poner 0 si quedan pendientes)
      const saldoRestante = Math.max(0, Math.round((saldoReal - netoSeleccionado) * 100) / 100);
      await tx.comercio.update({
        where: { id_comercio },
        data: { saldo_acumulado_mili: saldoRestante }
      });

      return {
        ...liquidacion,
        _metadata: metadata
      };
    }, { timeout: 60000 });
  },

  /**
   * Obtiene el historial de liquidaciones de un comercio con datos agregados.
   */
  async getLiquidations(id_comercio) {
    const liquidaciones = await prisma.liquidacion.findMany({
      where: { id_comercio },
      include: {
        comercio: { select: { nombre: true } },
        ventas: {
          select: {
            id_venta: true,
            total_venta: true,
            metodo_pago: true,
            fecha_hora: true,
          }
        }
      },
      orderBy: { fecha_cierre: 'desc' }
    });

    // Enriquecer cada liquidación con datos agregados
    return liquidaciones.map(liq => {
      // Parsear metadata de la observación si existe
      let metadata = {};
      let observacionLimpia = liq.observacion || '';
      if (liq.observacion && liq.observacion.includes('||META||')) {
        const parts = liq.observacion.split('||META||');
        observacionLimpia = parts[0].trim();
        try {
          metadata = JSON.parse(parts[1].trim());
        } catch { /* ignore parse errors */ }
      }

      return {
        id_liquidacion: liq.id_liquidacion,
        id_comercio: liq.id_comercio,
        comercio_nombre: liq.comercio?.nombre || '',
        fecha_cierre: liq.fecha_cierre,
        total_ventas_netas: Number(liq.total_ventas_netas),
        monto_recibido: Number(liq.monto_recibido),
        diferencia: Number(liq.diferencia),
        observacion: observacionLimpia,
        estado: liq.estado,
        cant_ventas: liq.ventas.length,
        total_bruto: metadata.total_bruto || liq.ventas.reduce((a, v) => a + Number(v.total_venta), 0),
        desglose_metodo_pago: metadata.desglose_metodo_pago || {},
        resumen_productos: metadata.resumen_productos || [],
        descuento_comercial: Number(metadata.descuento_comercial || 0),
        neto_ventas: Number(metadata.neto_ventas || liq.total_ventas_netas),
        ventas: liq.ventas
      };
    });
  },

  async ajustarSaldoHuerfano(id_comercio) {
    const pendientes = await prisma.ventaCabecera.count({
      where: { id_comercio, id_liquidacion: null, estado: 'ACTIVA' }
    });
    if (pendientes > 0) {
      throw new Error('Todavía hay ventas activas sin liquidar. Liquidá esos tickets; no se puede ajustar el saldo.');
    }
    const comercio = await prisma.comercio.update({
      where: { id_comercio },
      data: { saldo_acumulado_mili: 0 },
      select: { id_comercio: true, nombre: true, saldo_acumulado_mili: true }
    });
    return comercio;
  }
};

module.exports = liquidationService;
