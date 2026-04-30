const prisma = require('../config/prisma');

const liquidationService = {
  /**
   * Preview: obtiene un resumen de todo lo pendiente de liquidar para un comercio.
   * Incluye: ventas pendientes, desglose por método de pago, devoluciones y neto.
   */
  async getPreviewData(id_comercio) {
    // 1. Ventas pendientes (sin liquidar)
    const ventasPendientes = await prisma.ventaCabecera.findMany({
      where: {
        id_comercio,
        id_liquidacion: null,
      },
      include: {
        detalles: true,
        usuario: { select: { nombre: true, apellido: true } }
      },
      orderBy: { fecha_hora: 'asc' }
    });

    if (ventasPendientes.length === 0) {
      return {
        hayDatos: false,
        cantVentas: 0,
        totalVentasBruto: 0,
        totalVentasNeto: 0,
        totalDevoluciones: 0,
        netoFinal: 0,
        desgloseMetodoPago: {},
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

    // 5. Comercio con saldo actual
    const comercio = await prisma.comercio.findUnique({
      where: { id_comercio },
      select: { saldo_acumulado_mili: true, nombre: true }
    });

    return {
      hayDatos: true,
      comercioNombre: comercio?.nombre || '',
      cantVentas: ventasPendientes.length,
      totalVentasBruto: Math.round(totalVentasBruto * 100) / 100,
      totalVentasNeto: Math.round(totalVentasNeto * 100) / 100,
      saldoAcumulado: Number(comercio?.saldo_acumulado_mili || 0),
      totalDevoluciones: Math.round(totalDevoluciones * 100) / 100,
      cantDevoluciones: devoluciones.length,
      netoFinal: Number(comercio?.saldo_acumulado_mili || 0),
      desgloseMetodoPago,
      rangoFechas: {
        desde: fechaDesde,
        hasta: fechaHasta
      },
      ventas: ventasPendientes.map(v => ({
        id_venta: v.id_venta,
        fecha: v.fecha_hora,
        total: Number(v.total_venta),
        metodo_pago: v.metodo_pago,
        vendedor: v.usuario ? `${v.usuario.nombre} ${v.usuario.apellido}` : 'N/A',
        cantItems: v.detalles.reduce((a, d) => a + d.cantidad, 0)
      }))
    };
  },

  /**
   * Genera una liquidación para un comercio agrupando todas las ventas no liquidadas.
   * Ahora acepta monto_recibido opcional para registrar diferencias.
   */
  async generateLiquidation({ id_comercio, monto_recibido, observacion }) {
    return await prisma.$transaction(async (tx) => {
      // 1. Buscar todas las ventas cabecera no liquidadas de este comercio
      const ventasPendientes = await tx.ventaCabecera.findMany({
        where: {
          id_comercio,
          id_liquidacion: null,
        },
        include: {
          detalles: true
        }
      });

      if (ventasPendientes.length === 0) {
        throw new Error('No hay ventas pendientes para liquidar en este comercio.');
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

      // 3. Obtener saldo real del comercio (ya tiene devoluciones descontadas en tiempo real)
      const comercio = await tx.comercio.findUnique({
        where: { id_comercio },
        select: { saldo_acumulado_mili: true }
      });
      const saldoReal = Number(comercio?.saldo_acumulado_mili || 0);

      // 4. Calcular monto recibido y diferencia
      // Si Mili especificó cuánto recibió, usamos ese valor. Si no, asumimos el saldo real.
      const montoRecibido = (monto_recibido !== undefined && monto_recibido !== null) 
        ? parseFloat(monto_recibido) 
        : saldoReal;
      const diferencia = montoRecibido - saldoReal;

      // 5. Metadata enriquecida para la observación
      const metadata = {
        cant_ventas: ventasPendientes.length,
        total_bruto: Math.round(totalVentasBruto * 100) / 100,
        desglose_metodo_pago: desgloseMetodoPago,
        saldo_al_cerrar: saldoReal,
        monto_recibido_manual: monto_recibido !== undefined && monto_recibido !== null
      };

      const obsText = observacion || 'Liquidación semanal';
      const obsConMetadata = `${obsText} ||META|| ${JSON.stringify(metadata)}`;

      // 6. Crear la Liquidación
      const liquidacion = await tx.liquidacion.create({
        data: {
          id_comercio,
          total_ventas_netas: saldoReal,
          monto_recibido: montoRecibido,
          diferencia: Math.round(diferencia * 100) / 100,
          observacion: obsConMetadata,
          estado: 'CERRADA',
        },
      });

      // 7. Actualizar todas las ventas pendientes
      const ventasIds = ventasPendientes.map(v => v.id_venta);
      await tx.ventaCabecera.updateMany({
        where: { id_venta: { in: ventasIds } },
        data: { id_liquidacion: liquidacion.id_liquidacion },
      });

      // 8. Resetear saldo a 0
      await tx.comercio.update({
        where: { id_comercio },
        data: { saldo_acumulado_mili: 0 }
      });

      return {
        ...liquidacion,
        _metadata: metadata
      };
    });
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
        ventas: liq.ventas
      };
    });
  }
};

module.exports = liquidationService;
