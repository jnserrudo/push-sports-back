const { Prisma } = require('@prisma/client');

// Las entidades que queremos auditar
const AUDITABLE_MODELS = ['Producto', 'Comercio', 'Usuario', 'Categoria', 'Proveedor', 'Marca', 'TipoComercio', 'Descuento', 'Oferta', 'Combo'];

const auditExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          
          const monitoredOps = ['create', 'update', 'delete'];
          
          if (AUDITABLE_MODELS.includes(model) && monitoredOps.includes(operation)) {
             
             // NOTA: Para obtener los valores anteriores requerimos de una busqueda antes de la mutacion.
             // Para un prototipo lo simplificaremos haciendo el query original y luego una insercion asincrona en auditoria.
             
             // Ejecutamos la operacion solicitada
             const result = await query(args);

             // En un contexto real, deberiamos extraer el id_usuario del AsyncLocalStorage.
             // Para el prototipo, buscaremos el primer usuario ADMIN o usaremos un placeholder.
             let currentUserId = "00000000-0000-0000-0000-000000000000"; // Placeholder UUID
             
             try {
                 const firstUser = await client.usuario.findFirst({ where: { activo: true } });
                 if (firstUser) currentUserId = firstUser.id_usuario;
             } catch (e) {
                 // Si falla (ej: no hay tablas aun), ignoramos
             }

             const auditoriaData = {
                 id_usuario: currentUserId,
                 entidad_afectada: model,
                 accion: operation.toUpperCase(),
                 valor_nuevo: operation !== 'delete' ? JSON.stringify(result) : null,
                 valor_anterior: operation === 'delete' ? JSON.stringify(result) : null, 
             };

             // Registro asincrono
             client.auditoriaSistema.create({ data: auditoriaData }).catch(e => console.error("Error auditing", e));

             // Si es una eliminación crítica, notificar a los admins
             if (operation === 'delete' && ['Producto', 'Comercio', 'Usuario'].includes(model)) {
                 const { notifyAdmins } = require('./notificationService');
                 notifyAdmins({
                     titulo: 'ALERTA: Eliminación Crítica',
                     mensaje: `Se ha eliminado un registro de la entidad "${model}". Operador ID: ${currentUserId}`,
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

module.exports = auditExtension;
