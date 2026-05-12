const consultaService = require('../services/consultaServiceSimple');

class ConsultaControllerSimple {
  // Crear nueva consulta (endpoint público)
  async crearConsulta(req, res) {
    try {
      const consulta = await consultaService.crearConsulta(req.body);
      
      res.status(201).json({
        success: true,
        message: 'Consulta creada exitosamente',
        data: consulta
      });
    } catch (error) {
      console.error('Error en crearConsulta:', error);
      res.status(400).json({
        success: false,
        message: error.message || 'Error al crear consulta',
        error: error.message
      });
    }
  }

  // Listar consultas (endpoint protegido)
  async listarConsultas(req, res) {
    try {
      const filtros = {
        pagina: parseInt(req.query.pagina) || 1,
        limite: parseInt(req.query.limite) || 20,
        estado: req.query.estado,
        id_sucursal: req.query.id_sucursal,
        fecha_inicio: req.query.fecha_inicio,
        fecha_fin: req.query.fecha_fin,
        busqueda: req.query.busqueda
      };

      const resultado = await consultaService.listarConsultas(filtros);

      res.json({
        success: true,
        message: 'Consultas obtenidas exitosamente',
        data: resultado
      });
    } catch (error) {
      console.error('Error en listarConsultas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al listar consultas',
        error: error.message
      });
    }
  }

  // Obtener consulta por ID (endpoint protegido)
  async obtenerConsulta(req, res) {
    try {
      const { id } = req.params;
      const consulta = await consultaService.obtenerConsultaPorId(id);

      res.json({
        success: true,
        message: 'Consulta obtenida exitosamente',
        data: consulta
      });
    } catch (error) {
      console.error('Error en obtenerConsulta:', error);
      if (error.message === 'Consulta no encontrada') {
        res.status(404).json({
          success: false,
          message: 'Consulta no encontrada'
        });
      } else {
        res.status(500).json({
          success: false,
          message: 'Error al obtener consulta',
          error: error.message
        });
      }
    }
  }

  // Actualizar estado de consulta (endpoint protegido)
  async actualizarEstado(req, res) {
    try {
      const { id } = req.params;
      const { estado } = req.body;

      if (!['PENDIENTE', 'EN_PROCESO', 'CONFIRMED', 'CANCELADO'].includes(estado)) {
        return res.status(400).json({
          success: false,
          message: 'Estado no válido'
        });
      }

      const consulta = await consultaService.actualizarEstado(id, estado);

      res.json({
        success: true,
        message: 'Estado actualizado exitosamente',
        data: consulta
      });
    } catch (error) {
      console.error('Error en actualizarEstado:', error);
      res.status(500).json({
        success: false,
        message: 'Error al actualizar estado',
        error: error.message
      });
    }
  }

  // Eliminar consulta (endpoint protegido)
  async eliminarConsulta(req, res) {
    try {
      const { id } = req.params;
      await consultaService.eliminarConsulta(id);

      res.json({
        success: true,
        message: 'Consulta eliminada exitosamente'
      });
    } catch (error) {
      console.error('Error en eliminarConsulta:', error);
      res.status(500).json({
        success: false,
        message: 'Error al eliminar consulta',
        error: error.message
      });
    }
  }

  // Obtener estadísticas (endpoint protegido)
  async obtenerEstadisticas(req, res) {
    try {
      const estadisticas = await consultaService.obtenerEstadisticas();

      res.json({
        success: true,
        message: 'Estadísticas obtenidas exitosamente',
        data: estadisticas
      });
    } catch (error) {
      console.error('Error en obtenerEstadisticas:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener estadísticas',
        error: error.message
      });
    }
  }

  // Obtener consultas pendientes para notificaciones (endpoint protegido)
  async obtenerConsultasPendientes(req, res) {
    try {
      const resultado = await consultaService.obtenerConsultasPendientes();

      res.json({
        success: true,
        message: 'Consultas pendientes obtenidas exitosamente',
        data: resultado
      });
    } catch (error) {
      console.error('Error en obtenerConsultasPendientes:', error);
      res.status(500).json({
        success: false,
        message: 'Error al obtener consultas pendientes',
        error: error.message
      });
    }
  }
}

module.exports = new ConsultaControllerSimple();
