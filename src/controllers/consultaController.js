const consultaService = require('../services/consultaService');
const { validationResult } = require('express-validator');

class ConsultaController {
  // Crear nueva consulta (endpoint público)
  async crearConsulta(req, res) {
    try {
      // Validar entrada
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Error de validación',
          errors: errors.array()
        });
      }

      const consulta = await consultaService.crearConsulta(req.body);

      res.status(201).json({
        success: true,
        message: 'Consulta creada exitosamente',
        data: {
          id: consulta.id_consulta,
          estado: consulta.estado,
          fecha: consulta.fecha_consulta
        }
      });
    } catch (error) {
      console.error('Error en crearConsulta:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error al crear consulta'
      });
    }
  }

  // Listar consultas (endpoint protegido)
  async listarConsultas(req, res) {
    try {
      console.log('📋 [CONTROLLER] listarConsultas - Query params:', req.query);
      const filtros = {
        pagina: parseInt(req.query.pagina) || 1,
        limite: parseInt(req.query.limite) || 20,
        estado: req.query.estado,
        id_sucursal: req.query.id_sucursal,
        fecha_inicio: req.query.fecha_inicio,
        fecha_fin: req.query.fecha_fin,
        busqueda: req.query.busqueda
      };

      console.log('🔍 [CONTROLLER] Filtros procesados:', filtros);
      const resultado = await consultaService.listarConsultas(filtros);
      console.log('📊 [CONTROLLER] Resultado del servicio:', {
        total: resultado.total,
        consultasLength: resultado.consultas?.length
      });

      res.json({
        success: true,
        data: resultado
      });
    } catch (error) {
      console.error('❌ [CONTROLLER] Error en listarConsultas:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error al listar consultas'
      });
    }
  }

  // Obtener detalle de consulta
  async obtenerConsulta(req, res) {
    try {
      const { id } = req.params;
      const consulta = await consultaService.obtenerConsulta(id);

      res.json({
        success: true,
        data: consulta
      });
    } catch (error) {
      console.error('Error en obtenerConsulta:', error);
      if (error.message === 'Consulta no encontrada') {
        return res.status(404).json({
          success: false,
          message: 'Consulta no encontrada'
        });
      }
      res.status(500).json({
        success: false,
        message: error.message || 'Error al obtener consulta'
      });
    }
  }

  // Actualizar estado de consulta
  async actualizarEstado(req, res) {
    try {
      const { id } = req.params;
      const { estado } = req.body;
      const id_usuario = req.usuario.id_usuario;

      if (!estado) {
        return res.status(400).json({
          success: false,
          message: 'El estado es requerido'
        });
      }

      const consulta = await consultaService.actualizarEstado(id, estado, id_usuario);

      res.json({
        success: true,
        message: 'Estado actualizado exitosamente',
        data: consulta
      });
    } catch (error) {
      console.error('Error en actualizarEstado:', error);
      if (error.message === 'Consulta no encontrada') {
        return res.status(404).json({
          success: false,
          message: 'Consulta no encontrada'
        });
      }
      if (error.message === 'Estado no válido') {
        return res.status(400).json({
          success: false,
          message: 'Estado no válido'
        });
      }
      res.status(500).json({
        success: false,
        message: error.message || 'Error al actualizar estado'
      });
    }
  }

  // Convertir consulta a venta
  async convertirAVenta(req, res) {
    try {
      const { id } = req.params;
      const { metodo_pago, observaciones } = req.body;
      const id_usuario = req.usuario.id_usuario;

      const resultado = await consultaService.convertirAVenta(id, id_usuario, {
        metodo_pago,
        observaciones
      });

      res.json({
        success: true,
        message: 'Consulta convertida a venta exitosamente',
        data: resultado
      });
    } catch (error) {
      console.error('Error en convertirAVenta:', error);
      if (error.message === 'Consulta no encontrada') {
        return res.status(404).json({
          success: false,
          message: 'Consulta no encontrada'
        });
      }
      if (error.message.includes('debe estar en estado EN_PROCESO')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      if (error.message.includes('ya fue convertida')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      res.status(500).json({
        success: false,
        message: error.message || 'Error al convertir a venta'
      });
    }
  }

  // Eliminar consulta
  async eliminarConsulta(req, res) {
    try {
      const { id } = req.params;
      const id_usuario = req.usuario.id_usuario;

      const resultado = await consultaService.eliminarConsulta(id, id_usuario);

      res.json({
        success: true,
        message: 'Consulta eliminada exitosamente',
        data: resultado
      });
    } catch (error) {
      console.error('Error en eliminarConsulta:', error);
      if (error.message === 'Consulta no encontrada') {
        return res.status(404).json({
          success: false,
          message: 'Consulta no encontrada'
        });
      }
      if (error.message.includes('ya fue convertida')) {
        return res.status(400).json({
          success: false,
          message: error.message
        });
      }
      res.status(500).json({
        success: false,
        message: error.message || 'Error al eliminar consulta'
      });
    }
  }

  // Obtener estadísticas
  async obtenerEstadisticas(req, res) {
    try {
      const filtros = {
        fecha_inicio: req.query.fecha_inicio,
        fecha_fin: req.query.fecha_fin
      };

      const estadisticas = await consultaService.obtenerEstadisticas(filtros);

      res.json({
        success: true,
        data: estadisticas
      });
    } catch (error) {
      console.error('Error en obtenerEstadisticas:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Error al obtener estadísticas'
      });
    }
  }

  // Obtener consultas pendientes para badge de notificaciones
  async obtenerPendientes(req, res) {
    try {
      const resultado = await consultaService.listarConsultas({
        estado: 'PENDIENTE',
        limite: 5,
        pagina: 1
      });

      res.json({
        success: true,
        data: {
          total: resultado.total,
          consultas: resultado.consultas
        }
      });
    } catch (error) {
      console.error('Error en obtenerPendientes:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener consultas pendientes'
      });
    }
  }
}

module.exports = new ConsultaController();
