const { Prisma } = require('@prisma/client');
const { AsyncLocalStorage } = require('async_hooks');

// Crear almacenamiento asíncrono para el contexto de la solicitud
const auditContext = new AsyncLocalStorage();

// Las entidades que queremos auditar
const AUDITABLE_MODELS = [
    'Producto', 'ProductoVariante', 'Comercio', 'Usuario', 
    'Categoria', 'Proveedor', 'Marca', 'TipoComercio', 
    'Descuento', 'Oferta', 'Combo', 
    'InventarioComercio', 'InventarioComercioVariante',
    'MovimientoStock', 'MovimientoStockVariante',
    'VentaCabecera', 'VentaDetalle', 'VentaDetalleVariante',
    'Devolucion', 'Liquidacion'
];

// Función para establecer el contexto de auditoría
const setAuditUser = (userId) => {
    const store = auditContext.getStore();
    if (store) {
        store.userId = userId;
    }
};

// Middleware para inicializar el contexto de auditoría
const auditMiddleware = (req, res, next) => {
    const store = { userId: req.user?.id_usuario || null };
    auditContext.run(store, () => {
        next();
    });
};

const auditExtension = Prisma.defineExtension((client) => {
    return client.$extends({
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    
                    const monitoredOps = ['create', 'update', 'delete'];
                    
                    if (AUDITABLE_MODELS.includes(model) && monitoredOps.includes(operation)) {
                        
                        // Capturar valor anterior para updates y deletes
                        let valorAnterior = null;
                        
                        if ((operation === 'update' || operation === 'delete') && args.where) {
                            try {
                                const registroPrevio = await client[model].findUnique({ 
                                    where: args.where 
                                });
                                if (registroPrevio) {
                                    valorAnterior = JSON.stringify(registroPrevio);
                                }
                            } catch (e) {
                                console.warn(`No se pudo capturar valor anterior para ${model}:`, e.message);
                            }
                        }
                        
                        // Ejecutamos la operacion solicitada
                        const result = await query(args);

                        // Obtener el ID del usuario del contexto
                        const store = auditContext.getStore();
                        let currentUserId = store?.userId || "00000000-0000-0000-0000-000000000000";
                        
                        // Si no hay usuario en contexto, intentar obtener el primer usuario activo
                        if (!currentUserId || currentUserId === "00000000-0000-0000-0000-000000000000") {
                            try {
                                const firstUser = await client.usuario.findFirst({ 
                                    where: { activo: true },
                                    select: { id_usuario: true }
                                });
                                if (firstUser) currentUserId = firstUser.id_usuario;
                            } catch (e) {
                                // Ignorar error
                            }
                        }

                        // Preparar datos de auditoría
                        const auditoriaData = {
                            id_usuario: currentUserId,
                            entidad_afectada: model,
                            accion: operation.toUpperCase(),
                            valor_nuevo: operation !== 'delete' ? JSON.stringify(result).substring(0, 10000) : null,
                            valor_anterior: valorAnterior ? valorAnterior.substring(0, 10000) : null,
                        };

                        // Registro asíncrono (no bloqueante)
                        client.auditoriaSistema.create({ 
                            data: auditoriaData 
                        }).catch(e => console.error("Error auditing:", e.message));

                        // Notificar eliminaciones críticas
                        if (operation === 'delete' && 
                            ['Producto', 'Comercio', 'Usuario', 'ProductoVariante', 'VentaCabecera'].includes(model)) {
                            const { notifyAdmins } = require('./notificationService');
                            const esVariante = model === 'ProductoVariante';
                            notifyAdmins({
                                titulo: esVariante ? 'ALERTA: Variante Eliminada' : `ALERTA: ${model} Eliminado`,
                                mensaje: esVariante 
                                    ? `Se ha eliminado una variante de producto. Operador ID: ${currentUserId}`
                                    : `Se ha eliminado un registro de "${model}". Operador ID: ${currentUserId}`,
                                tipo: 'SYSTEM'
                            }).catch(() => {});
                        }

                        return result;
                    }

                    // Para queries normales o no auditados
                    return query(args);
                },
            },
        },
    });
});

module.exports = { auditExtension, auditMiddleware, setAuditUser, auditContext };
