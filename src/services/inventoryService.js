const prisma = require('../config/prisma');

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

      // 2. Obtener el inventario actual
      let inventario = await tx.inventarioComercio.findUnique({
        where: {
          id_comercio_id_producto: {
            id_comercio: id_comercio,
            id_producto: id_producto,
          },
        },
      });

      // Si no existe, crearlo con 0
      if (!inventario) {
        inventario = await tx.inventarioComercio.create({
          data: {
            id_comercio: id_comercio,
            id_producto: id_producto,
            cantidad_actual: 0,
            comision_pactada_porcentaje: 0, 
          },
        });
      }

      const saldo_anterior = inventario.cantidad_actual;
      // Multiplicar por el factor (ej: Venta = -1, Ingreso = 1)
      const cambioReal = Math.abs(cantidad_cambio) * tipoMov.factor_multiplicador;
      const saldo_posterior = saldo_anterior + cambioReal;

      // 3. Actualizar el inventario
      const inventarioActualizado = await tx.inventarioComercio.update({
        where: { id_inventario: inventario.id_inventario },
        data: { cantidad_actual: saldo_posterior },
      });

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

      // 5. Evaluar Notificaciones de Stock Mínimo
      if (inventarioActualizado.cantidad_actual < inventarioActualizado.stock_minimo_alerta) {
        await tx.notificacion.create({
          data: {
            id_usuario: id_usuario, // Idealmente enviar al admin del comercio
            titulo: 'Alerta de Stock Mínimo',
            mensaje: `El producto ID ${id_producto} en tu comercio ha caído por debajo del stock mínimo (${inventarioActualizado.stock_minimo_alerta}). Stock actual: ${inventarioActualizado.cantidad_actual}.`,
            tipo: 'STOCK_ALERT',
          },
        });
      }

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
