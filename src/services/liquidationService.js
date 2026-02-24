const prisma = require('../config/prisma');

const liquidationService = {
  /**
   * Genera una liquidación para un comercio agrupando todas las ventas no liquidadas.
   */
  async generateLiquidation({ id_comercio, observacion }) {
    return await prisma.$transaction(async (tx) => {
      // 1. Buscar todas las ventas cabecera no liquidadas de este comercio
      const ventasPendientes = await tx.ventaCabecera.findMany({
        where: {
          id_comercio: id_comercio,
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
      let totalVentasNetas = 0; // Suma de todos los netos históricos de todos los detalles
      
      for (const venta of ventasPendientes) {
          for (const detalle of venta.detalles) {
               totalVentasNetas += parseFloat(detalle.neto_mili_historico);
          }
      }

      // Por ahora, asumimos que se recibe exactamente el monto neto calculado.
      const montoRecibido = totalVentasNetas; 
      const diferencia = 0;

      // 3. Crear la Liquidación
      const liquidacion = await tx.liquidacion.create({
        data: {
          id_comercio: id_comercio,
          total_ventas_netas: totalVentasNetas,
          monto_recibido: montoRecibido,
          diferencia: diferencia,
          observacion: observacion || 'Liquidación automática de periodo',
          estado: 'CERRADA',
        },
      });

      // 4. Actualizar todas las ventas pendientes para relacionarlas con esta liquidación
      const ventasIds = ventasPendientes.map(v => v.id_venta);
      await tx.ventaCabecera.updateMany({
        where: {
          id_venta: { in: ventasIds },
        },
        data: {
          id_liquidacion: liquidacion.id_liquidacion,
        },
      });

      return liquidacion;
    });
  },

  /**
   * Obtiene el historial de liquidaciones de un comercio
   */
  async getLiquidations(id_comercio) {
      return await prisma.liquidacion.findMany({
          where: { id_comercio: id_comercio },
          include: {
              ventas: {
                   include: {
                        detalles: {
                             include: { producto: true }
                        }
                   }
              }
          },
          orderBy: { fecha_cierre: 'desc' }
      })
  }
};

module.exports = liquidationService;
