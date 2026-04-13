const prisma = require('../config/prisma');
const { sendLowStockAlert } = require('./emailService');

/**
 * Verifica si el stock de un producto (o variante) ha caído por debajo del mínimo
 * y envía alertas por email a los administradores correspondientes.
 */
async function checkAndSendStockAlert(id_comercio, id_producto, id_variante = null) {
    try {
        console.log(`[ALERT-SYSTEM] Verificando stock para ${id_producto} (V: ${id_variante}) en sucursal ${id_comercio}`);

        let stockActual = 0;
        let stockMinimo = 0;
        let nombreProducto = '';

        if (id_variante) {
            // Caso con variante
            const invVar = await prisma.inventarioComercioVariante.findFirst({
                where: { 
                    id_variante,
                    inventario_padre: { id_comercio }
                },
                include: { 
                    variante: { include: { producto: true } } 
                }
            });

            if (!invVar) return;
            stockActual = invVar.cantidad_actual;
            stockMinimo = invVar.stock_minimo_alerta || 5;
            nombreProducto = `${invVar.variante.producto.nombre} (${Object.values(invVar.variante.atributos_valores || {}).join(' / ')})`;
        } else {
            // Caso producto base
            const inv = await prisma.inventarioComercio.findUnique({
                where: { id_comercio_id_producto: { id_comercio, id_producto } },
                include: { producto: true }
            });

            if (!inv) return;
            stockActual = inv.cantidad_actual;
            stockMinimo = inv.stock_minimo_alerta || 5;
            nombreProducto = inv.producto.nombre;
        }

        // Si el stock es bajo, disparar emails
        if (stockActual <= stockMinimo) {
            // 1. Obtener la sucursal para el contexto
            const sucursal = await prisma.comercio.findUnique({ where: { id_comercio } });
            
            // 2. Buscar destinatarios: SuperAdmins (rol 1) y Admin Sede (rol 2) del comercio
            const admins = await prisma.usuario.findMany({
                where: {
                    OR: [
                        { id_rol: 1 }, // SuperAdmins
                        { id_rol: 2, id_comercio_asignado: id_comercio } // Admin Local
                    ],
                    activo: true
                },
                select: { email: true }
            });

            const emailList = admins.map(a => a.email).filter(e => e);

            if (emailList.length > 0) {
                await sendLowStockAlert(emailList, {
                    producto: nombreProducto,
                    sucursal: sucursal?.nombre || 'Sucursal desconocida',
                    cantidad: stockActual,
                    minimo: stockMinimo
                });
                console.log(`[ALERT-SYSTEM] Alertas enviadas a: ${emailList.join(', ')}`);
            }
        }
    } catch (error) {
        console.error('[ALERT-SYSTEM] Error procesando alerta de stock:', error);
    }
}

module.exports = {
    checkAndSendStockAlert
};
