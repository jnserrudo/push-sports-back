const express = require('express');
const router = express.Router();
const prisma = require('../config/prisma');
const { authMiddleware, roleMiddleware } = require('../middlewares/authMiddleware');

// ═══════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════

/**
 * Genera el producto cartesiano de un objeto de atributos
 * Ej: {SABOR: ['V', 'C'], TAMAÑO: ['1KG', '2KG']} => 
 *     [{SABOR: 'V', TAMAÑO: '1KG'}, {SABOR: 'V', TAMAÑO: '2KG'}, ...]
 */
function generarCombinacionesAtributos(atributos) {
  const keys = Object.keys(atributos);
  const values = keys.map(k => atributos[k]);
  
  function cartesianProduct(arrays) {
    return arrays.reduce((acc, curr) => 
      acc.flatMap(a => curr.map(c => [...a, c])),
      [[]]
    );
  }
  
  const combinaciones = cartesianProduct(values);
  
  return combinaciones.map(combo => {
    const obj = {};
    keys.forEach((key, index) => {
      obj[key] = combo[index];
    });
    return obj;
  });
}

/**
 * Genera SKU automático desde valores de atributos
 * Ej: {SABOR: 'VAINILLA', TAMAÑO: '1KG'} => 'VAN-1KG'
 */
function generarSKU(atributosValores, productoNombre) {
  const valores = Object.values(atributosValores);
  const abreviaturas = valores.map(v => {
    // Tomar primeras 3 letras mayúsculas o las iniciales de cada palabra
    const palabras = v.split(/[\s\-_]+/);
    if (palabras.length === 1) return v.substring(0, 3).toUpperCase();
    return palabras.map(p => p[0]).join('').toUpperCase();
  });
  return abreviaturas.join('-');
}

// ═══════════════════════════════════════════════════════════
// GET - Listar variantes de un producto
// ═══════════════════════════════════════════════════════════
router.get('/productos/:id_producto/variantes', authMiddleware, async (req, res) => {
  try {
    const { id_producto } = req.params;
    
    // Verificar que el producto existe
    const producto = await prisma.producto.findUnique({
      where: { id_producto },
      select: { id_producto: true, nombre: true, usa_variantes: true, atributos: true }
    });
    
    if (!producto) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    
    const variantes = await prisma.productoVariante.findMany({
      where: { id_producto },
      orderBy: { fecha_creacion: 'asc' }
    });
    
    res.json({
      producto: {
        id_producto: producto.id_producto,
        nombre: producto.nombre,
        usa_variantes: producto.usa_variantes,
        atributos: producto.atributos
      },
      variantes,
      total_variantes: variantes.length
    });
    
  } catch (error) {
    console.error('Error GET /productos/:id/variantes:', error);
    res.status(500).json({ error: 'Error al obtener variantes', detail: error.message });
  }
});

// ═══════════════════════════════════════════════════════════
// POST - Generar variantes automáticamente desde atributos
// ═══════════════════════════════════════════════════════════
router.post('/productos/:id_producto/variantes/generar', 
  authMiddleware, 
  roleMiddleware([1, 2]), 
  async (req, res) => {
    try {
      const { id_producto } = req.params;
      const { atributos: atributosBody } = req.body; // Atributos opcionales desde el frontend
      
      // Obtener producto con atributos
      const producto = await prisma.producto.findUnique({
        where: { id_producto },
        select: { 
          id_producto: true, 
          nombre: true, 
          atributos: true,
          variantes: { select: { id_variante: true, atributos_valores: true } }
        }
      });
      
      if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      
      // Usar atributos del body si se proporcionan, sino leer de la DB
      let atributos;
      if (atributosBody && Object.keys(atributosBody).length > 0) {
        atributos = atributosBody;
        // Guardar los atributos actualizados en la DB para mantener sincronización
        await prisma.producto.update({
          where: { id_producto },
          data: { atributos: atributos }
        });
      } else {
        // Parsear atributos de la DB
        atributos = typeof producto.atributos === 'string' 
          ? JSON.parse(producto.atributos || '{}') 
          : (producto.atributos || {});
      }
      
      if (Object.keys(atributos).length === 0) {
        return res.status(400).json({ 
          error: 'El producto no tiene atributos definidos',
          message: 'Definí atributos primero (ej: SABOR, TAMAÑO) antes de generar variantes'
        });
      }
      
      // Verificar que todos los atributos tengan valores
      const atributosConValores = {};
      for (const [key, value] of Object.entries(atributos)) {
        if (Array.isArray(value) && value.length > 0) {
          atributosConValores[key] = value;
        }
      }
      
      if (Object.keys(atributosConValores).length === 0) {
        return res.status(400).json({
          error: 'Los atributos no tienen valores definidos',
          message: 'Agregá valores a los atributos (ej: SABOR: [Vainilla, Chocolate])'
        });
      }
      
      // Generar todas las combinaciones
      const combinaciones = generarCombinacionesAtributos(atributosConValores);
      
      // Verificar variantes existentes para no duplicar
      const variantesExistentes = producto.variantes.map(v => JSON.stringify(v.atributos_valores));
      
      const nuevasVariantes = [];
      
      for (const combo of combinaciones) {
        const comboString = JSON.stringify(combo);
        
        // Saltear si ya existe
        if (variantesExistentes.includes(comboString)) {
          continue;
        }
        
        // Crear nueva variante
        const sku = generarSKU(combo, producto.nombre);
        
        const variante = await prisma.productoVariante.create({
          data: {
            id_producto,
            atributos_valores: combo,
            sku_variante: sku,
            stock_central: 0,
            activo: true
          }
        });
        
        nuevasVariantes.push(variante);
      }
      
      res.status(201).json({
        message: `Se generaron ${nuevasVariantes.length} nuevas variantes`,
        combinaciones_totales: combinaciones.length,
        variantes_existentes: producto.variantes.length,
        variantes_creadas: nuevasVariantes.length,
        variantes: nuevasVariantes
      });
      
    } catch (error) {
      console.error('Error POST /generar variantes:', error);
      res.status(500).json({ error: 'Error al generar variantes', detail: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST - Crear variante manualmente
// ═══════════════════════════════════════════════════════════
router.post('/productos/:id_producto/variantes', 
  authMiddleware, 
  roleMiddleware([1, 2]), 
  async (req, res) => {
    try {
      const { id_producto } = req.params;
      const { atributos_valores, sku_variante, stock_central = 0 } = req.body;
      
      if (!atributos_valores || Object.keys(atributos_valores).length === 0) {
        return res.status(400).json({ error: 'Se requieren atributos_valores' });
      }
      
      // Verificar que el producto existe
      const producto = await prisma.producto.findUnique({
        where: { id_producto },
        select: { id_producto: true, nombre: true }
      });
      
      if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      
      // Verificar que no exista ya una variante con los mismos atributos
      const existente = await prisma.productoVariante.findFirst({
        where: {
          id_producto,
          atributos_valores: atributos_valores
        }
      });
      
      if (existente) {
        return res.status(409).json({ 
          error: 'Ya existe una variante con estos atributos',
          variante_existente: existente
        });
      }
      
      // Generar SKU si no se proporcionó
      const sku = sku_variante || generarSKU(atributos_valores, producto.nombre);
      
      const variante = await prisma.productoVariante.create({
        data: {
          id_producto,
          atributos_valores,
          sku_variante: sku,
          stock_central: parseInt(stock_central) || 0,
          activo: true
        }
      });
      
      res.status(201).json({
        message: 'Variante creada exitosamente',
        variante
      });
      
    } catch (error) {
      console.error('Error POST crear variante:', error);
      res.status(500).json({ error: 'Error al crear variante', detail: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// PUT - Actualizar una variante
// ═══════════════════════════════════════════════════════════
router.put('/variantes/:id_variante', 
  authMiddleware, 
  roleMiddleware([1, 2]), 
  async (req, res) => {
    try {
      const { id_variante } = req.params;
      const { sku_variante, stock_central, precio_variante, activo } = req.body;
      
      const variante = await prisma.productoVariante.findUnique({
        where: { id_variante }
      });
      
      if (!variante) {
        return res.status(404).json({ error: 'Variante no encontrada' });
      }
      
      const data = {};
      if (sku_variante !== undefined) data.sku_variante = sku_variante;
      if (stock_central !== undefined) data.stock_central = parseInt(stock_central);
      if (precio_variante !== undefined) data.precio_variante = parseFloat(precio_variante);
      if (activo !== undefined) data.activo = activo;
      
      // Si se modifica stock, actualizar también el stock_central del producto padre
      const varianteActual = await prisma.productoVariante.findUnique({
        where: { id_variante },
        include: { producto: true }
      });
      
      const actualizada = await prisma.productoVariante.update({
        where: { id_variante },
        data
      });
      
      // Actualizar stock central del producto si cambió el stock de la variante
      if (stock_central !== undefined) {
        const todasLasVariantes = await prisma.productoVariante.findMany({
          where: { id_producto: varianteActual.id_producto, activo: true }
        });
        const nuevoStockCentral = todasLasVariantes.reduce((sum, v) => 
          v.id_variante === id_variante ? sum + parseInt(stock_central) : sum + v.stock_central, 0
        );
        
        await prisma.producto.update({
          where: { id_producto: varianteActual.id_producto },
          data: { stock_central: nuevoStockCentral }
        });
      }
      
      res.json({
        message: 'Variante actualizada',
        variante: actualizada
      });
      
    } catch (error) {
      console.error('Error PUT variante:', error);
      res.status(500).json({ error: 'Error al actualizar variante', detail: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// DELETE - Desactivar una variante (soft delete)
// ═══════════════════════════════════════════════════════════
router.delete('/variantes/:id_variante', 
  authMiddleware, 
  roleMiddleware([1]), 
  async (req, res) => {
    try {
      const { id_variante } = req.params;
      
      const variante = await prisma.productoVariante.findUnique({
        where: { id_variante },
        include: {
          inventarios: true
        }
      });
      
      if (!variante) {
        return res.status(404).json({ error: 'Variante no encontrada' });
      }
      
      // Verificar si tiene stock en alguna sede
      const stockTotal = variante.inventarios.reduce((sum, inv) => sum + inv.cantidad_actual, 0);
      
      if (stockTotal > 0) {
        return res.status(400).json({
          error: 'No se puede desactivar: la variante tiene stock en sedes',
          stock_total: stockTotal,
          message: 'Primero transferí o ajustá el stock de esta variante a 0'
        });
      }
      
      await prisma.productoVariante.update({
        where: { id_variante },
        data: { activo: false }
      });
      
      res.json({
        message: 'Variante desactivada exitosamente',
        id_variante
      });
      
    } catch (error) {
      console.error('Error DELETE variante:', error);
      res.status(500).json({ error: 'Error al desactivar variante', detail: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// POST - Migrar stock existente a variantes
// ═══════════════════════════════════════════════════════════
router.post('/productos/:id_producto/migrar-stock',
  authMiddleware,
  roleMiddleware([1, 2]),
  async (req, res) => {
    try {
      const { id_producto } = req.params;
      const { distribucion } = req.body; // { id_variante1: 10, id_variante2: 20, ... }
      
      if (!distribucion || Object.keys(distribucion).length === 0) {
        return res.status(400).json({ error: 'Se requiere la distribución de stock' });
      }
      
      // Obtener producto y stock central
      const producto = await prisma.producto.findUnique({
        where: { id_producto },
        include: {
          variantes: { where: { activo: true } }
        }
      });
      
      if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      
      const stockCentralActual = producto.stock_central;
      const totalDistribuido = Object.values(distribucion).reduce((a, b) => a + parseInt(b), 0);
      
      // Validar que la suma coincida (con tolerancia de 0)
      if (totalDistribuido !== stockCentralActual) {
        return res.status(400).json({
          error: 'La distribución no coincide con el stock central',
          stock_central: stockCentralActual,
          total_distribuido: totalDistribuido,
          diferencia: stockCentralActual - totalDistribuido
        });
      }
      
      // Verificar que todas las variantes existan y pertenezcan al producto
      const variantesIds = producto.variantes.map(v => v.id_variante);
      const distribucionIds = Object.keys(distribucion);
      
      const idsInvalidos = distribucionIds.filter(id => !variantesIds.includes(id));
      if (idsInvalidos.length > 0) {
        return res.status(400).json({
          error: 'Algunas variantes no pertenecen a este producto',
          ids_invalidos: idsInvalidos
        });
      }
      
      // Realizar la migración en transacción
      const resultado = await prisma.$transaction(async (tx) => {
        // 1. Descontar del stock central del producto (poner en 0)
        await tx.producto.update({
          where: { id_producto },
          data: { stock_central: 0 }
        });
        
        // 2. Sumar a cada variante
        const actualizaciones = [];
        for (const [id_variante, cantidad] of Object.entries(distribucion)) {
          const variante = await tx.productoVariante.update({
            where: { id_variante },
            data: {
              stock_central: { increment: parseInt(cantidad) }
            }
          });
          actualizaciones.push({
            id_variante,
            atributos: variante.atributos_valores,
            cantidad_asignada: parseInt(cantidad)
          });
        }
        
        return actualizaciones;
      });
      
      res.json({
        message: 'Stock migrado exitosamente a variantes',
        stock_migrado: totalDistribuido,
        distribucion: resultado
      });
      
    } catch (error) {
      console.error('Error POST migrar stock:', error);
      res.status(500).json({ error: 'Error al migrar stock', detail: error.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════
// PUT - Activar/desactivar sistema de variantes para un producto
// ═══════════════════════════════════════════════════════════
router.put('/productos/:id_producto/usa-variantes',
  authMiddleware,
  roleMiddleware([1, 2]),
  async (req, res) => {
    try {
      const { id_producto } = req.params;
      const { usa_variantes } = req.body;
      
      if (typeof usa_variantes !== 'boolean') {
        return res.status(400).json({ error: 'usa_variantes debe ser booleano' });
      }
      
      const producto = await prisma.producto.findUnique({
        where: { id_producto },
        include: { variantes: true }
      });
      
      if (!producto) {
        return res.status(404).json({ error: 'Producto no encontrado' });
      }
      
      // Si se está activando, verificar que tenga variantes
      if (usa_variantes && producto.variantes.length === 0) {
        return res.status(400).json({
          error: 'El producto no tiene variantes definidas',
          message: 'Generá variantes primero antes de activar el sistema'
        });
      }
      
      // Si se está activando y hay stock central, requerir migración
      let requiere_migracion = false;
      if (usa_variantes && producto.stock_central > 0) {
        requiere_migracion = true;
      }
      
      const actualizado = await prisma.producto.update({
        where: { id_producto },
        data: {
          usa_variantes,
          // Si estamos activando y hay stock, marcar que necesita migración
          // Esto se manejaría con un campo en inventario_comercio
        }
      });
      
      res.json({
        message: usa_variantes 
          ? 'Sistema de variantes activado'
          : 'Sistema de variantes desactivado',
        usa_variantes: actualizado.usa_variantes,
        requiere_migracion,
        stock_central: producto.stock_central,
        total_variantes: producto.variantes.length
      });
      
    } catch (error) {
      console.error('Error PUT usa_variantes:', error);
      res.status(500).json({ error: 'Error al cambiar configuración', detail: error.message });
    }
  }
);

module.exports = router;
