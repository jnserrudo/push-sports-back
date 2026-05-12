const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
// const emailService = require('./emailService');
const notificacionService = require('./notificacionService');

const prisma = new PrismaClient();

/**
 * Genera un token único para seguimiento de consulta
 * @returns {string} Token único de 32 caracteres
 */
function generarTokenSeguimiento() {
  return crypto.randomBytes(16).toString('hex');
}

class ConsultaService {
  // Crear nueva consulta desde web
  async crearConsulta(datosConsulta) {
    try {
      const {
        nombre_cliente,
        telefono_cliente,
        email_cliente,
        id_sucursal,
        metodo_entrega,
        comentarios,
        items,
        total,
        cantidad_items
      } = datosConsulta;

      // Validar datos básicos
      console.log('Datos recibidos:', JSON.stringify(datosConsulta, null, 2));
      
      if (!nombre_cliente || !telefono_cliente || !id_sucursal || !items || items.length === 0) {
        console.log('Validación fallida:', {
          nombre_cliente: !!nombre_cliente,
          telefono_cliente: !!telefono_cliente,
          id_sucursal: !!id_sucursal,
          items: !!items,
          itemsLength: items?.length
        });
        throw new Error('Datos requeridos incompletos');
      }

      // Verificar sucursal existe y está activa
      const sucursal = await prisma.comercio.findFirst({
        where: {
          id_comercio: id_sucursal,
          activo: true
        }
      });

      if (!sucursal) {
        throw new Error('Sucursal no válida o inactiva');
      }

      // Temporalmente deshabilitar validación de productos para pruebas
      console.log('Validación de productos deshabilitada temporalmente');
      const productos = []; // Placeholder

      // Generar token único para seguimiento
      const tokenSeguimiento = generarTokenSeguimiento();
      console.log('🔑 [SERVICE] Token generado:', tokenSeguimiento);
      
      // Crear consulta y items en una transacción
      console.log('💾 [SERVICE] Iniciando transacción para crear consulta...');
      const consulta = await prisma.$transaction(async (tx) => {
        // Crear consulta principal
        console.log('📝 [SERVICE] Creando consulta principal...');
        const nuevaConsulta = await tx.consultaPedido.create({
          data: {
            nombre_cliente: nombre_cliente.trim(),
            telefono_cliente: telefono_cliente.trim(),
            email_cliente: email_cliente?.trim() || null,
            id_sucursal,
            metodo_entrega,
            comentarios: comentarios?.trim() || null,
            total: parseFloat(total),
            cantidad_items: parseInt(cantidad_items),
            estado: 'PENDIENTE',
            origen: 'WEB',
            token_seguimiento: tokenSeguimiento
          },
          include: {
            sucursal: true
          }
        });
        console.log('✅ [SERVICE] Consulta principal creada:', nuevaConsulta.id_consulta);

        // Crear items de la consulta
        console.log('📦 [SERVICE] Creando items de la consulta...');
        const itemsConsulta = await Promise.all(
          items.map(item => {
            const subtotal = parseFloat(item.cantidad) * parseFloat(item.precio_unitario);

            return tx.consultaPedidoItem.create({
              data: {
                id_consulta: nuevaConsulta.id_consulta,
                id_producto: item.id_producto,
                nombre_producto: item.nombre_producto,
                cantidad: parseInt(item.cantidad),
                precio_unitario: parseFloat(item.precio_unitario),
                subtotal: subtotal,
                id_variante: item.id_variante || null,
                variante_info: item.variante_info || null
              }
            });
          })
        );
        console.log('✅ [SERVICE] Items creados:', itemsConsulta.length);

        return {
          ...nuevaConsulta,
          items: itemsConsulta
        };
      });

      // Enviar notificación por email (temporalmente comentado)
      // await this.enviarNotificacionEmail(consulta);

      // Enviar notificación en el sistema
      await notificacionService.notificarConsultaWeb(consulta);

      console.log('Consulta creada exitosamente:', consulta.id_consulta);
      return consulta;
    } catch (error) {
      console.error('Error al crear consulta:', error);
      throw error;
    }
  }

  // Listar consultas con filtros y paginación
  async listarConsultas(filtros = {}) {
    try {
      const {
        pagina = 1,
        limite = 20,
        estado,
        id_sucursal,
        fecha_inicio,
        fecha_fin,
        busqueda
      } = filtros;

      const skip = (pagina - 1) * limite;
      const where = {};

      // Filtros
      if (estado) where.estado = estado;
      if (id_sucursal) where.id_sucursal = id_sucursal;
      
      if (fecha_inicio || fecha_fin) {
        where.fecha_consulta = {};
        if (fecha_inicio) where.fecha_consulta.gte = new Date(fecha_inicio);
        if (fecha_fin) where.fecha_consulta.lte = new Date(fecha_fin);
      }

      if (busqueda) {
        where.OR = [
          {
            nombre_cliente: {
              contains: busqueda,
              mode: 'insensitive'
            }
          },
          {
            telefono_cliente: {
              contains: busqueda,
              mode: 'insensitive'
            }
          },
          {
            email_cliente: {
              contains: busqueda,
              mode: 'insensitive'
            }
          }
        ];
      }

      // Consulta principal
      const [consultas, total] = await Promise.all([
        prisma.consultaPedido.findMany({
          where,
          include: {
            sucursal: {
              select: {
                id_comercio: true,
                nombre: true
              }
            },
            items: {
              include: {
                producto: {
                  select: {
                    id_producto: true,
                    nombre: true,
                    imagen_url: true
                  }
                }
              }
            },
            venta_generada: {
              select: {
                id_venta: true,
                fecha_hora: true
              }
            }
          },
          orderBy: {
            fecha_consulta: 'desc'
          },
          skip,
          take: limite
        }),
        prisma.consultaPedido.count({ where })
      ]);

      return {
        consultas,
        total,
        pagina,
        limite,
        totalPaginas: Math.ceil(total / limite)
      };
    } catch (error) {
      console.error('Error al listar consultas:', error);
      throw error;
    }
  }

  // Obtener detalle de una consulta
  async obtenerConsulta(id_consulta) {
    try {
      const consulta = await prisma.consultaPedido.findUnique({
        where: { id_consulta },
        include: {
          sucursal: true,
          items: {
            include: {
              producto: {
                include: {
                  categoria: true,
                  marca: true
                }
              },
              variante: true
            }
          },
          venta_generada: true
        }
      });

      if (!consulta) {
        throw new Error('Consulta no encontrada');
      }

      return consulta;
    } catch (error) {
      console.error('Error al obtener consulta:', error);
      throw error;
    }
  }

  // Actualizar estado de consulta
  async actualizarEstado(id_consulta, nuevo_estado, id_usuario, motivo = null) {
    try {
      const estadosValidos = ['PENDIENTE', 'EN_PROCESO', 'CONFIRMADO', 'CANCELADO'];
      if (!estadosValidos.includes(nuevo_estado)) {
        throw new Error('Estado no válido');
      }

      const consultaActual = await prisma.consultaPedido.findUnique({
        where: { id_consulta }
      });

      if (!consultaActual) {
        throw new Error('Consulta no encontrada');
      }

      const consultaActualizada = await prisma.consultaPedido.update({
        where: { id_consulta },
        data: {
          estado: nuevo_estado,
          fecha_actualizacion: new Date()
        },
        include: {
          sucursal: true,
          items: {
            include: {
              producto: true
            }
          }
        }
      });

      // Registrar auditoría
      await prisma.auditoriaSistema.create({
        data: {
          id_usuario,
          entidad_afectada: 'ConsultaPedido',
          id_entidad_afectada: id_consulta,
          accion: 'UPDATE',
          descripcion_accion: `Estado de consulta actualizado de ${consultaActual.estado} a ${nuevo_estado}`,
          datos_anteriores: JSON.stringify({ estado: consultaActual.estado }),
          datos_nuevos: JSON.stringify({ estado: nuevo_estado }),
          endpoint: `/api/consultas/${id_consulta}/estado`,
          metodo_http: 'PUT'
        }
      });

      return consultaActualizada;
    } catch (error) {
      console.error('Error al actualizar estado:', error);
      throw error;
    }
  }

  // Convertir consulta a venta
  async convertirAVenta(id_consulta, id_usuario, datosVenta = {}) {
    try {
      const consulta = await this.obtenerConsulta(id_consulta);

      if (consulta.estado !== 'EN_PROCESO') {
        throw new Error('La consulta debe estar en estado EN_PROCESO para convertir a venta');
      }

      if (consulta.id_venta_generada) {
        throw new Error('Esta consulta ya fue convertida a venta');
      }

      const { metodo_pago = 'EFECTIVO', observaciones = '' } = datosVenta;

      // Crear venta en transacción
      const venta = await prisma.$transaction(async (tx) => {
        // Crear cabecera de venta
        const nuevaVenta = await tx.ventaCabecera.create({
          data: {
            id_comercio: consulta.id_sucursal,
            id_usuario,
            total_venta: consulta.total,
            metodo_pago,
            tipo_venta: 'VENTA'
          }
        });

        // Crear detalles de venta
        await Promise.all(
          consulta.items.map(item => {
            return tx.ventaDetalle.create({
              data: {
                id_venta: nuevaVenta.id_venta,
                id_producto: item.id_producto,
                cantidad: item.cantidad,
                precio_unitario_cobrado: item.precio_unitario,
                precio_pushsport_historico: item.producto.precio_venta_sugerido,
                costo_unitario_historico: item.producto.costo_compra,
                tiene_variantes: !!item.id_variante
              }
            });
          })
        );

        // Actualizar consulta con ID de venta generada
        await tx.consultaPedido.update({
          where: { id_consulta },
          data: {
            id_venta_generada: nuevaVenta.id_venta,
            estado: 'CONFIRMED'
          }
        });

        return nuevaVenta;
      });

      // Registrar auditoría
      await prisma.auditoriaSistema.create({
        data: {
          id_usuario,
          entidad_afectada: 'ConsultaPedido',
          id_entidad_afectada: id_consulta,
          accion: 'UPDATE',
          descripcion_accion: `Consulta convertida a venta #${venta.id_venta}`,
          datos_anteriores: JSON.stringify({ id_venta_generada: null }),
          datos_nuevos: JSON.stringify({ id_venta_generada: venta.id_venta }),
          endpoint: `/api/consultas/${id_consulta}/convertir-venta`,
          metodo_http: 'POST'
        }
      });

      return {
        venta,
        consulta: await this.obtenerConsulta(id_consulta)
      };
    } catch (error) {
      console.error('Error al convertir a venta:', error);
      throw error;
    }
  }

  // Enviar notificación por email
  async enviarNotificacionEmail(consulta) {
    try {
      const asunto = `Nueva Consulta de Pedido Web #${consulta.id_consulta.substring(0, 8).toUpperCase()}`;
      
      let productosHtml = '';
      consulta.items.forEach(item => {
        productosHtml += `
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #eee;">
              ${item.cantidad}x ${item.nombre_producto}
            </td>
            <td style="padding: 8px; border-bottom: 1px solid #eee; text-align: right;">
              ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(item.subtotal)}
            </td>
          </tr>
        `;
      });

      const htmlContent = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: #00E5FF; color: white; padding: 20px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px;">NUEVA CONSULTA WEB</h1>
            <p style="margin: 5px 0 0 0; opacity: 0.9;">Pedido recibido desde la landing page</p>
          </div>
          
          <div style="padding: 20px; background: #f9f9f9;">
            <h2 style="color: #333; margin-top: 0;">Datos del Cliente</h2>
            <p><strong>Nombre:</strong> ${consulta.nombre_cliente}</p>
            <p><strong>Teléfono:</strong> ${consulta.telefono_cliente}</p>
            ${consulta.email_cliente ? `<p><strong>Email:</strong> ${consulta.email_cliente}</p>` : ''}
            <p><strong>Sucursal:</strong> ${consulta.sucursal.nombre}</p>
            <p><strong>Entrega:</strong> ${consulta.metodo_entrega === 'retiro' ? 'Retiro en sucursal' : 'Envío a domicilio'}</p>
            ${consulta.comentarios ? `<p><strong>Comentarios:</strong> ${consulta.comentarios}</p>` : ''}
          </div>
          
          <div style="padding: 20px;">
            <h2 style="color: #333;">Productos Solicitados</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <thead>
                <tr style="background: #f0f0f0;">
                  <th style="padding: 10px; text-align: left;">Producto</th>
                  <th style="padding: 10px; text-align: right;">Subtotal</th>
                </tr>
              </thead>
              <tbody>
                ${productosHtml}
              </tbody>
              <tfoot>
                <tr style="background: #00E5FF; color: white;">
                  <th style="padding: 10px; text-align: left;">TOTAL</th>
                  <th style="padding: 10px; text-align: right; font-size: 18px;">
                    ${new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(consulta.total)}
                  </th>
                </tr>
              </tfoot>
            </table>
          </div>
          
          <div style="padding: 20px; background: #f9f9f9; text-align: center;">
            <p style="margin: 0; color: #666; font-size: 14px;">
              Fecha: ${new Date(consulta.fecha_consulta).toLocaleString('es-AR')}
            </p>
            <p style="margin: 5px 0 0 0; color: #666; font-size: 14px;">
              Origen: Landing Web - PushSport
            </p>
          </div>
        </div>
      `;

      await emailService.sendEmail({
        to: process.env.ADMIN_EMAIL || 'admin@pushsport.com',
        subject: asunto,
        html: htmlContent
      });

      console.log('Email de notificación enviado para consulta:', consulta.id_consulta);
    } catch (error) {
      console.error('Error al enviar email de notificación:', error);
      // No lanzamos error para no interrumpir el flujo principal
    }
  }

  // Eliminar consulta (soft delete)
  async eliminarConsulta(id_consulta, id_usuario) {
    try {
      const consulta = await prisma.consultaPedido.findUnique({
        where: { id_consulta }
      });

      if (!consulta) {
        throw new Error('Consulta no encontrada');
      }

      if (consulta.id_venta_generada) {
        throw new Error('No se puede eliminar una consulta que ya fue convertida a venta');
      }

      await prisma.consultaPedido.delete({
        where: { id_consulta }
      });

      // Registrar auditoría
      await prisma.auditoriaSistema.create({
        data: {
          id_usuario,
          entidad_afectada: 'ConsultaPedido',
          id_entidad_afectada: id_consulta,
          accion: 'DELETE',
          descripcion_accion: `Consulta eliminada: ${consulta.nombre_cliente}`,
          datos_anteriores: JSON.stringify(consulta),
          endpoint: `/api/consultas/${id_consulta}`,
          metodo_http: 'DELETE'
        }
      });

      return { message: 'Consulta eliminada correctamente' };
    } catch (error) {
      console.error('Error al eliminar consulta:', error);
      throw error;
    }
  }

  // Obtener estadísticas
  async obtenerEstadisticas(filtros = {}) {
    try {
      const { fecha_inicio, fecha_fin } = filtros;
      const where = {};

      if (fecha_inicio || fecha_fin) {
        where.fecha_consulta = {};
        if (fecha_inicio) where.fecha_consulta.gte = new Date(fecha_inicio);
        if (fecha_fin) where.fecha_consulta.lte = new Date(fecha_fin);
      }

      const [
        totalConsultas,
        consultasPorEstado,
        totalConvertidas,
        ticketPromedio,
        consultasPorSucursal
      ] = await Promise.all([
        // Total de consultas
        prisma.consultaPedido.count({ where }),
        
        // Consultas por estado
        prisma.consultaPedido.groupBy({
          by: ['estado'],
          where,
          _count: { estado: true }
        }),
        
        // Total convertidas a ventas
        prisma.consultaPedido.count({
          where: {
            ...where,
            id_venta_generada: { not: null }
          }
        }),
        
        // Ticket promedio
        prisma.consultaPedido.aggregate({
          where,
          _avg: { total: true }
        }),
        
        // Consultas por sucursal
        prisma.consultaPedido.groupBy({
          by: ['id_sucursal'],
          where,
          _count: { id_sucursal: true },
          _sum: { total: true }
        })
      ]);

      // Obtener nombres de sucursales
      const sucursalesIds = consultasPorSucursal.map(item => item.id_sucursal);
      const sucursales = await prisma.comercio.findMany({
        where: { id_comercio: { in: sucursalesIds } },
        select: { id_comercio: true, nombre: true }
      });

      const sucursalesMap = sucursales.reduce((acc, suc) => {
        acc[suc.id_comercio] = suc.nombre;
        return acc;
      }, {});

      return {
        totalConsultas,
        consultasPorEstado: consultasPorEstado.reduce((acc, item) => {
          acc[item.estado] = item._count.estado;
          return acc;
        }, {}),
        totalConvertidas,
        tasaConversion: totalConsultas > 0 ? (totalConvertidas / totalConsultas * 100).toFixed(2) : 0,
        ticketPromedio: ticketPromedio._avg.total || 0,
        consultasPorSucursal: consultasPorSucursal.map(item => ({
          id_sucursal: item.id_sucursal,
          nombre_sucursal: sucursalesMap[item.id_sucursal] || 'Desconocida',
          total: item._count.id_sucursal,
          monto_total: item._sum.total || 0
        }))
      };
    } catch (error) {
      console.error('Error al obtener estadísticas:', error);
      throw error;
    }
  }

  // Obtener consulta por token de seguimiento (vista pública)
  async obtenerConsultaPorToken(token) {
    try {
      console.log('🔍 [SERVICE] Buscando consulta con token:', token);
      
      const consulta = await prisma.consultaPedido.findUnique({
        where: { token_seguimiento: token },
        include: {
          sucursal: true,
          items: true
        }
      });

      if (!consulta) {
        throw new Error('Consulta no encontrada');
      }

      // Retornar solo información pública (sin datos sensibles del admin)
      return {
        id_consulta: consulta.id_consulta,
        estado: consulta.estado,
        fecha_consulta: consulta.fecha_consulta,
        fecha_actualizacion: consulta.fecha_actualizacion,
        metodo_entrega: consulta.metodo_entrega,
        total: consulta.total,
        cantidad_items: consulta.cantidad_items,
        sucursal: {
          nombre: consulta.sucursal.nombre,
          direccion: consulta.sucursal.direccion
        },
        items: consulta.items.map(item => ({
          nombre_producto: item.nombre_producto,
          cantidad: item.cantidad,
          precio_unitario: item.precio_unitario,
          subtotal: item.subtotal,
          imagen: item.producto?.imagen_url,
          variante_info: item.variante_info
        }))
      };
    } catch (error) {
      console.error('Error al obtener consulta por token:', error);
      throw error;
    }
  }
}

module.exports = new ConsultaService();
