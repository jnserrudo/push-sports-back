/**
 * Prisma Middleware/Extension para interceptar operaciones UPDATE y DELETE
 * y guardar un registro en AUDITORIA_SISTEMA.
 */

const { Prisma } = require('@prisma/client');

// Las entidades que queremos auditar
const AUDITABLE_MODELS = ['Producto', 'Comercio', 'Usuario', 'Categoria', 'Proveedor', 'Marca', 'TipoComercio'];

const auditExtension = Prisma.defineExtension((client) => {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          
          if (AUDITABLE_MODELS.includes(model) && (operation === 'update' || operation === 'delete')) {
             
             // NOTA: Para obtener los valores anteriores requerimos de una busqueda antes de la mutacion.
             // Para un prototipo lo simplificaremos haciendo el query original y luego una insercion asincrona en auditoria.
             // Idealmente esto se hace dentro de una transaccion o obteniendo el usuario que hace la operacion del contexto.

             // Ejecutamos la operacion solicitada
             const result = await query(args);

             // En un contexto real, deberiamos extraer el id_usuario del AsyncLocalStorage.
             // Para el prototipo, buscaremos el primer usuario ADMIN o usaremos un placeholder.
             // NOTA: Para que esto funcione, debe existir al menos un usuario en la DB.
             let currentUserId = "00000000-0000-0000-0000-000000000000"; // Placeholder UUID
             
             try {
                 const firstUser = await client.usuario.findFirst();
                 if (firstUser) currentUserId = firstUser.id_usuario;
             } catch (e) {
                 // Si falla (ej: no hay tablas aun), ignoramos
             }

             const auditoriaData = {
                 id_usuario: currentUserId,
                 entidad_afectada: model,
                 accion: operation.toUpperCase(),
                 valor_nuevo: operation === 'update' ? JSON.stringify(result) : null,
                 valor_anterior: operation === 'delete' ? JSON.stringify(result) : "Valor anterior no capturado en prototipo", 
             };

             // Fire & forget
             client.auditoriaSistema.create({ data: auditoriaData }).catch(e => console.error("Error auditing", e));

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
