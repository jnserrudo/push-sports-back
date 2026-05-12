const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class NotificacionService {
  // Crear notificación para usuarios
  async crearNotificacion(datos) {
    try {
      const {
        id_usuario,
        titulo,
        mensaje,
        tipo = 'INFO',
        entidad_afectada = null,
        id_entidad_afectada = null
      } = datos;

      const notificacion = await prisma.notificacion.create({
        data: {
          id_usuario,
          titulo,
          mensaje,
          tipo,
          fecha_envio: new Date()
        }
      });

      // Si hay entidad relacionada, registrar auditoría
      if (entidad_afectada && id_entidad_afectada) {
        await prisma.auditoriaSistema.create({
          data: {
            id_usuario,
            entidad_afectada,
            id_entidad_afectada,
            accion: 'CREATE',
            descripcion_accion: `Notificación creada: ${titulo}`,
            datos_nuevos: JSON.stringify({ titulo, mensaje, tipo }),
            endpoint: `/api/notificaciones`,
            metodo_http: 'POST'
          }
        });
      }

      return notificacion;
    } catch (error) {
      console.error('Error al crear notificación:', error);
      throw error;
    }
  }

  // Crear notificación masiva para todos los usuarios de un rol
  async crearNotificacionMasiva(datos) {
    try {
      const {
        titulo,
        mensaje,
        tipo = 'INFO',
        id_rol,
        entidad_afectada = null,
        id_entidad_afectada = null
      } = datos;

      // Obtener usuarios del rol especificado
      const usuarios = await prisma.usuario.findMany({
        where: {
          id_rol,
          activo: true
        },
        select: {
          id_usuario: true
        }
      });

      // Crear notificaciones para cada usuario
      const notificaciones = await Promise.all(
        usuarios.map(usuario =>
          this.crearNotificacion({
            id_usuario: usuario.id_usuario,
            titulo,
            mensaje,
            tipo,
            entidad_afectada,
            id_entidad_afectada
          })
        )
      );

      return {
        total: notificaciones.length,
        notificaciones
      };
    } catch (error) {
      console.error('Error al crear notificación masiva:', error);
      throw error;
    }
  }

  // Notificar nueva consulta web
  async notificarConsultaWeb(consulta) {
    try {
      const titulo = 'Nueva Consulta Web';
      const mensaje = `Consulta de ${consulta.nombre_cliente} - ${consulta.total.toLocaleString('es-AR', { style: 'currency', currency: 'ARS' })}`;

      // Enviar a todos los administradores y vendedores
      await Promise.all([
        this.crearNotificacionMasiva({
          titulo,
          mensaje,
          tipo: 'CONSULTA_WEB',
          id_rol: 1, // SUPER_ADMIN
          entidad_afectada: 'ConsultaPedido',
          id_entidad_afectada: consulta.id_consulta
        }),
        this.crearNotificacionMasiva({
          titulo,
          mensaje,
          tipo: 'CONSULTA_WEB',
          id_rol: 2, // ADMIN_SUCURSAL
          entidad_afectada: 'ConsultaPedido',
          id_entidad_afectada: consulta.id_consulta
        }),
        this.crearNotificacionMasiva({
          titulo,
          mensaje,
          tipo: 'CONSULTA_WEB',
          id_rol: 3, // VENDEDOR
          entidad_afectada: 'ConsultaPedido',
          id_entidad_afectada: consulta.id_consulta
        })
      ]);

      console.log('Notificaciones de consulta web enviadas');
    } catch (error) {
      console.error('Error al notificar consulta web:', error);
      // No lanzamos error para no interrumpir el flujo principal
    }
  }

  // Obtener notificaciones de un usuario
  async obtenerNotificaciones(id_usuario, filtros = {}) {
    try {
      const {
        pagina = 1,
        limite = 20,
        no_leidas = false
      } = filtros;

      const skip = (pagina - 1) * limite;
      const where = { id_usuario };

      if (no_leidas) {
        where.leido = false;
      }

      const [notificaciones, total] = await Promise.all([
        prisma.notificacion.findMany({
          where,
          orderBy: {
            fecha_envio: 'desc'
          },
          skip,
          take: limite
        }),
        prisma.notificacion.count({ where })
      ]);

      return {
        notificaciones,
        total,
        pagina,
        limite,
        totalPaginas: Math.ceil(total / limite)
      };
    } catch (error) {
      console.error('Error al obtener notificaciones:', error);
      throw error;
    }
  }

  // Marcar notificación como leída
  async marcarComoLeida(id_notificacion, id_usuario) {
    try {
      const notificacion = await prisma.notificacion.findFirst({
        where: {
          id_notificacion,
          id_usuario
        }
      });

      if (!notificacion) {
        throw new Error('Notificación no encontrada');
      }

      const actualizada = await prisma.notificacion.update({
        where: { id_notificacion },
        data: { leido: true }
      });

      // Registrar auditoría
      await prisma.auditoriaSistema.create({
        data: {
          id_usuario,
          entidad_afectada: 'Notificacion',
          id_entidad_afectada: id_notificacion,
          accion: 'UPDATE',
          descripcion_accion: 'Notificación marcada como leída',
          datos_anteriores: JSON.stringify({ leido: false }),
          datos_nuevos: JSON.stringify({ leido: true }),
          endpoint: `/api/notificaciones/${id_notificacion}`,
          metodo_http: 'PUT'
        }
      });

      return actualizada;
    } catch (error) {
      console.error('Error al marcar notificación como leída:', error);
      throw error;
    }
  }

  // Marcar todas las notificaciones de un usuario como leídas
  async marcarTodasComoLeidas(id_usuario) {
    try {
      const resultado = await prisma.notificacion.updateMany({
        where: {
          id_usuario,
          leido: false
        },
        data: {
          leido: true
        }
      });

      // Registrar auditoría
      if (resultado.count > 0) {
        await prisma.auditoriaSistema.create({
          data: {
            id_usuario,
            entidad_afectada: 'Notificacion',
            accion: 'UPDATE',
            descripcion_accion: `${resultado.count} notificaciones marcadas como leídas`,
            datos_nuevos: JSON.stringify({ count: resultado.count }),
            endpoint: `/api/notificaciones/marcar-leidas`,
            metodo_http: 'PUT'
          }
        });
      }

      return {
        actualizadas: resultado.count
      };
    } catch (error) {
      console.error('Error al marcar todas como leídas:', error);
      throw error;
    }
  }

  // Eliminar notificación
  async eliminarNotificacion(id_notificacion, id_usuario) {
    try {
      const notificacion = await prisma.notificacion.findFirst({
        where: {
          id_notificacion,
          id_usuario
        }
      });

      if (!notificacion) {
        throw new Error('Notificación no encontrada');
      }

      await prisma.notificacion.delete({
        where: { id_notificacion }
      });

      // Registrar auditoría
      await prisma.auditoriaSistema.create({
        data: {
          id_usuario,
          entidad_afectada: 'Notificacion',
          id_entidad_afectada: id_notificacion,
          accion: 'DELETE',
          descripcion_accion: `Notificación eliminada: ${notificacion.titulo}`,
          datos_anteriores: JSON.stringify(notificacion),
          endpoint: `/api/notificaciones/${id_notificacion}`,
          metodo_http: 'DELETE'
        }
      });

      return { message: 'Notificación eliminada correctamente' };
    } catch (error) {
      console.error('Error al eliminar notificación:', error);
      throw error;
    }
  }

  // Obtener contador de notificaciones no leídas
  async obtenerContadorNoLeidas(id_usuario) {
    try {
      const contador = await prisma.notificacion.count({
        where: {
          id_usuario,
          leido: false
        }
      });

      return { no_leidas: contador };
    } catch (error) {
      console.error('Error al obtener contador de no leídas:', error);
      throw error;
    }
  }

  // Limpiar notificaciones antiguas (más de 30 días)
  async limpiarNotificacionesAntiguas() {
    try {
      const fechaLimite = new Date();
      fechaLimite.setDate(fechaLimite.getDate() - 30);

      const resultado = await prisma.notificacion.deleteMany({
        where: {
          fecha_envio: {
            lt: fechaLimite
          }
        }
      });

      console.log(`Se eliminaron ${resultado.count} notificaciones antiguas`);
      return resultado;
    } catch (error) {
      console.error('Error al limpiar notificaciones antiguas:', error);
      throw error;
    }
  }
}

module.exports = new NotificacionService();
