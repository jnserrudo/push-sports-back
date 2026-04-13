const prisma = require('../config/prisma');
const { checkAndSendStockAlert } = require('./stockAlertService');

const inventoryService = {
  /**
   * Actualiza el stock de un producto en un comercio y registra el movimiento de kardex.
   * Ejecuta todo dentro de una transacción de Prisma.
   */
  async updateStock({ id_comercio, id_producto, id_usuario, id_tipo_movimiento, cantidad_cambio }, txParams = null) {
    const runInTransaction = async (tx) => {
      // 1. Obtener el tipo de movimiento para el factor multiplicador
      const tipoMov = await tx.tipoMovimiento.findUnique({
          where: { id_tipo_movimiento: parseInt(id_tipo_movimiento) }
      });

      if (!tipoMov) throw new Error("Tipo de movimiento no válido");

      // 2. Actualizar el inventario de forma ATÓMICA (Atomic Update)
      // Esto previene que dos transacciones simultáneas sobrescriban el saldo incorrectamente.
      const cambioReal = Math.abs(cantidad_cambio) * tipoMov.factor_multiplicador;

      const inventarioActualizado = await tx.inventarioComercio.upsert({
        where: {
          id_comercio_id_producto: {
            id_comercio: id_comercio,
            id_producto: id_producto,
          },
        },
        update: {
          cantidad_actual: { increment: cambioReal }
        },
        create: {
          id_comercio: id_comercio,
          id_producto: id_producto,
          cantidad_actual: cambioReal > 0 ? cambioReal : 0,
          comision_pactada_porcentaje: 0,
        }
      });

      const saldo_posterior = inventarioActualizado.cantidad_actual;
      const saldo_anterior = saldo_posterior - cambioReal;

      // 4. Registrar el movimiento en Kardex
      const movimiento = await tx.movimientoStock.create({
        data: {
          id_producto: id_producto,
          id_comercio: id_comercio,
          id_usuario: id_usuario,
          id_tipo_movimiento: parseInt(id_tipo_movimiento),
          cantidad_cambio: cambioReal,
          saldo_anterior: saldo_anterior,
          saldo_posterior: saldo_posterior,
        },
      });

      // 5. Evaluar Notificaciones de Stock Mínimo (Email + DB)
      // Hook de alerta asíncrono (no bloquea la transacción)
      setTimeout(() => {
          checkAndSendStockAlert(id_comercio, id_producto);
      }, 0);

      return { inventario: inventarioActualizado, movimiento };
    };

    // Permitir reutilizar una transacción existente si proviene de otro servicio (ej: Ventas)
    if (txParams) {
        return await runInTransaction(txParams);
    } else {
        return await prisma.$transaction(runInTransaction);
    }
  },

  async getInventory(id_comercio) {
      return await prisma.inventarioComercio.findMany({
          where: { id_comercio: id_comercio },
          include: { producto: true }
      });
  }
};

module.exports = inventoryService;
