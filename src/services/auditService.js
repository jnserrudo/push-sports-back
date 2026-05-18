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
    'Devolucion', 'Liquidacion',
    'Evento'
];

// Mapeo de campos ID por entidad
const ENTITY_ID_FIELDS = {
    'Producto': 'id_producto',
    'ProductoVariante': 'id_variante',
    'Comercio': 'id_comercio',
    'Usuario': 'id_usuario',
    'Categoria': 'id_categoria',
    'Proveedor': 'id_proveedor',
    'Marca': 'id_marca',
    'TipoComercio': 'id_tipo_comercio',
    'Descuento': 'id_descuento',
    'Oferta': 'id_oferta',
    'Combo': 'id_combo',
    'InventarioComercio': 'id_inventario',
    'InventarioComercioVariante': 'id_inventario_var',
    'MovimientoStock': 'id_movimiento',
    'MovimientoStockVariante': 'id_movimiento_var',
    'VentaCabecera': 'id_venta',
    'VentaDetalle': 'id_detalle',
    'VentaDetalleVariante': 'id_detalle_var',
    'Devolucion': 'id_devolucion',
    'Liquidacion': 'id_liquidacion',
    'Evento': 'id_evento'
};

// Función para calcular diferencias entre dos objetos
const calcularDiferencias = (anterior, nuevo) => {
    const cambios = {};
    const campos = new Set([...Object.keys(anterior || {}), ...Object.keys(nuevo || {})]);
    
    for (const campo of campos) {
        const valorAnterior = anterior?.[campo];
        const valorNuevo = nuevo?.[campo];
        
        // Comparar valores (manejar fechas, objetos, etc.)
        const strAnterior = JSON.stringify(valorAnterior);
        const strNuevo = JSON.stringify(valorNuevo);
        
        if (strAnterior !== strNuevo) {
            cambios[campo] = {
                antes: valorAnterior,
                despues: valorNuevo
            };
        }
    }
    
    return cambios;
};

// Generar descripción legible de la acción
const generarDescripcion = (model, operation, cambios, result) => {
    const nombresLegibles = {
        'Producto': 'Producto',
        'ProductoVariante': 'Variante',
        'Comercio': 'Sucursal',
        'Usuario': 'Usuario',
        'Categoria': 'Categoría',
        'Proveedor': 'Proveedor',
        'Marca': 'Marca',
        'TipoComercio': 'Tipo de Sede',
        'Descuento': 'Descuento',
        'Oferta': 'Oferta',
        'Combo': 'Combo',
        'InventarioComercio': 'Inventario',
        'InventarioComercioVariante': 'Stock de Variante',
        'MovimientoStock': 'Movimiento de Stock',
        'MovimientoStockVariante': 'Movimiento de Variante',
        'VentaCabecera': 'Venta',
        'VentaDetalle': 'Detalle de Venta',
        'VentaDetalleVariante': 'Venta con Variante',
        'Devolucion': 'Devolución',
        'Liquidacion': 'Liquidación',
        'Evento': 'Evento/Campaña'
    };
    
    const nombreEntidad = nombresLegibles[model] || model;
    const nombreItem = result?.nombre || result?.sku || result?.codigo || 'Item';
    
    switch (operation) {
        case 'create':
            return `Creó ${nombreEntidad}: "${nombreItem}"`;
        case 'delete':
            return `Eliminó ${nombreEntidad}: "${nombreItem}"`;
        case 'update':
            // Detectar desactivación/activación (borrado lógico)
            if (cambios && cambios.activo) {
                if (cambios.activo.despues === false) return `Desactivó ${nombreEntidad}: "${nombreItem}"`;
                if (cambios.activo.despues === true) return `Activó ${nombreEntidad}: "${nombreItem}"`;
            }

            if (cambios && Object.keys(cambios).length > 0) {
                const camposCambiados = Object.keys(cambios)
                    .filter(c => !c.startsWith('id_') && c !== 'updatedAt')
                    .slice(0, 3)
                    .join(', ');
                return `Modificó ${nombreEntidad} "${nombreItem}": cambió ${camposCambiados}${Object.keys(cambios).length > 3 ? '...' : ''}`;
            }
            return `Modificó ${nombreEntidad}: "${nombreItem}"`;
        case 'createMany':
            return `Creó múltiples registros (${result?.count || 0}) de ${nombreEntidad}`;
        case 'updateMany':
            return `Modificó múltiples registros (${result?.count || 0}) de ${nombreEntidad}`;
        case 'deleteMany':
            return `Eliminó múltiples registros (${result?.count || 0}) de ${nombreEntidad}`;
        default:
            return `${operation.toUpperCase()} en ${nombreEntidad}`;
    }
};

// Extraer IDs relacionados según la entidad (async para poder resolver padres)
const extraerIdsRelacionados = async (client, model, data) => {
    const ids = {};
    if (!data) return ids;
    
    // Extraer IDs directos que estén presentes en el resultado
    if (data.id_producto) ids.id_producto = data.id_producto;
    if (data.id_comercio) ids.id_comercio = data.id_comercio;
    if (data.id_variante) ids.id_variante = data.id_variante;
    if (data.id_venta) ids.id_venta = data.id_venta;
    if (data.id_proveedor) ids.id_proveedor = data.id_proveedor;
    
    // Para tablas hijas que NO tienen id_comercio/id_producto directamente,
    // buscar en la tabla padre.
    try {
        switch (model) {
            case 'MovimientoStockVariante':
                // Tiene id_movimiento → buscar MovimientoStock → id_comercio, id_producto
                if (data.id_movimiento && (!ids.id_comercio || !ids.id_producto)) {
                    const padre = await client.movimientoStock.findUnique({
                        where: { id_movimiento: data.id_movimiento },
                        select: { id_comercio: true, id_producto: true }
                    });
                    if (padre) {
                        if (!ids.id_comercio) ids.id_comercio = padre.id_comercio;
                        if (!ids.id_producto) ids.id_producto = padre.id_producto;
                    }
                }
                break;
                
            case 'InventarioComercioVariante':
                // Tiene id_inventario → buscar InventarioComercio → id_comercio, id_producto
                if (data.id_inventario && (!ids.id_comercio || !ids.id_producto)) {
                    const padre = await client.inventarioComercio.findUnique({
                        where: { id_inventario: data.id_inventario },
                        select: { id_comercio: true, id_producto: true }
                    });
                    if (padre) {
                        if (!ids.id_comercio) ids.id_comercio = padre.id_comercio;
                        if (!ids.id_producto) ids.id_producto = padre.id_producto;
                    }
                }
                break;
                
            case 'VentaDetalleVariante':
                // Tiene id_detalle → buscar VentaDetalle → id_producto, id_venta
                if (data.id_detalle && (!ids.id_producto || !ids.id_venta)) {
                    const padre = await client.ventaDetalle.findUnique({
                        where: { id_detalle: data.id_detalle },
                        select: { id_producto: true, id_venta: true }
                    });
                    if (padre) {
                        if (!ids.id_producto) ids.id_producto = padre.id_producto;
                        if (!ids.id_venta) ids.id_venta = padre.id_venta;
                    }
                }
                break;
                
            case 'ProductoVariante':
                // Ya tiene id_producto, pero asegurar id_variante
                if (!ids.id_variante && data.id_variante) ids.id_variante = data.id_variante;
                break;
        }
    } catch (e) {
        console.warn(`[Audit] No se pudieron resolver IDs padre para ${model}:`, e.message);
    }
    
    return ids;
};

// Función para establecer el contexto de auditoría con datos del request
const setAuditContext = (data) => {
    const store = auditContext.getStore();
    if (store) {
        Object.assign(store, data);
    }
};

// Función para establecer solo el usuario (backward compatible)
const setAuditUser = (userId) => {
    setAuditContext({ userId });
};

// Middleware mejorado para capturar contexto completo de la solicitud
const auditMiddleware = (req, res, next) => {
    const store = {
        userId: req.user?.id_usuario || null,
        userEmail: req.user?.email || null,
        userRol: req.user?.rol || null,
        // Campos de impersonación
        realUserId: req.realUser?.id_usuario || null,
        impersonatedUserId: req.impersonatedUser?.id_usuario || null,
        endpoint: req.originalUrl || req.url,
        metodo_http: req.method,
        ip_usuario: req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'],
        user_agent: req.headers['user-agent']
    };
    
    auditContext.run(store, () => {
        next();
    });
};

const auditExtension = Prisma.defineExtension((client) => {
    return client.$extends({
        query: {
            $allModels: {
                async $allOperations({ model, operation, args, query }) {
                    
                    const monitoredOps = ['create', 'update', 'delete', 'createMany', 'updateMany', 'deleteMany'];
                    
                    if (AUDITABLE_MODELS.includes(model) && monitoredOps.includes(operation)) {
                        
                        // Obtener usuario del contexto de la solicitud
                        const store = auditContext.getStore() || {};
                        const currentUserId = store.userId || null;
                        
                        // Si no hay usuario válido, ejecutar la query sin auditar
                        // (no podemos crear un registro de auditoría sin FK válida)
                        if (!currentUserId || currentUserId === "00000000-0000-0000-0000-000000000000") {
                            return query(args);
                        }
                        
                        // Capturar datos previos solo para update/delete de entidades principales
                        let datosAnteriores = null;
                        let registroPrevio = null;
                        
                        // Para entidades hijas de alto volumen, NO hacer findUnique previo (performance)
                        const SKIP_PREFETCH = [
                            'VentaDetalle', 'VentaDetalleVariante',
                            'MovimientoStockVariante', 'InventarioComercioVariante'
                        ];
                        
                        if ((operation === 'update' || operation === 'delete') && args.where && 
                            !SKIP_PREFETCH.includes(model)) {
                            try {
                                registroPrevio = await client[model].findUnique({ 
                                    where: args.where 
                                });
                                if (registroPrevio) {
                                    datosAnteriores = registroPrevio;
                                }
                            } catch (e) {
                                // Silenciar
                            }
                        }
                        
                        // Ejecutar la operación solicitada
                        const result = await query(args);
                        
                        // Extraer ID de la entidad afectada
                        const idField = ENTITY_ID_FIELDS[model];
                        const idEntidadAfectada = result?.[idField] || registroPrevio?.[idField] || null;
                        
                        // Calcular diferencias (skip para entidades hijas de alto volumen)
                        let cambiosDetectados = null;
                        if (!SKIP_PREFETCH.includes(model)) {
                            if (operation === 'update' && datosAnteriores && result) {
                                cambiosDetectados = calcularDiferencias(datosAnteriores, result);
                            } else if (operation === 'create' && result) {
                                cambiosDetectados = calcularDiferencias(null, result);
                            } else if (operation === 'delete' && registroPrevio) {
                                cambiosDetectados = calcularDiferencias(registroPrevio, null);
                            }
                        }
                        
                        // Generar descripción legible (incluir info de impersonación si aplica)
                        let descripcionAccion = generarDescripcion(
                            model, operation, cambiosDetectados, result || registroPrevio
                        );
                        
                        // Si hay impersonación, agregar prefijo a la descripción
                        if (store.realUserId && store.impersonatedUserId) {
                            descripcionAccion = `[IMPERSONACIÓN] ${descripcionAccion}`;
                        }
                        
                        // Extraer IDs directamente del resultado (sin queries adicionales)
                        const idsRelacionados = {};
                        const dataRef = result || registroPrevio || {};
                        if (dataRef.id_producto) idsRelacionados.id_producto = dataRef.id_producto;
                        if (dataRef.id_comercio) idsRelacionados.id_comercio = dataRef.id_comercio;
                        if (dataRef.id_variante) idsRelacionados.id_variante = dataRef.id_variante;
                        if (dataRef.id_venta) idsRelacionados.id_venta = dataRef.id_venta;
                        if (dataRef.id_proveedor) idsRelacionados.id_proveedor = dataRef.id_proveedor;
                        
                        // Preparar datos de auditoría
                        const auditoriaData = {
                            id_usuario: currentUserId,
                            // Campos de impersonación
                            id_usuario_real: store.realUserId || null,
                            id_usuario_impersonado: store.impersonatedUserId || null,
                            entidad_afectada: model,
                            id_entidad_afectada: idEntidadAfectada,
                            accion: operation.toUpperCase(),
                            descripcion_accion: descripcionAccion,
                            valor_anterior: datosAnteriores ? JSON.stringify(datosAnteriores).substring(0, 10000) : null,
                            valor_nuevo: !['delete', 'deleteMany'].includes(operation) && result ? JSON.stringify(result).substring(0, 10000) : null,
                            datos_anteriores: datosAnteriores ? JSON.stringify(datosAnteriores).substring(0, 20000) : null,
                            datos_nuevos: !['delete', 'deleteMany'].includes(operation) && (result || args.data) ? JSON.stringify(result || args.data).substring(0, 20000) : null,
                            cambios_detectados: cambiosDetectados ? JSON.stringify(cambiosDetectados).substring(0, 10000) : null,
                            endpoint: store.endpoint || null,
                            metodo_http: store.metodo_http || null,
                            ip_usuario: store.ip_usuario || null,
                            user_agent: store.user_agent || null,
                            ...idsRelacionados
                        };

                        // Registro asíncrono (no bloqueante, silencioso)
                        client.auditoriaSistema.create({ 
                            data: auditoriaData 
                        }).catch(() => {});

                        // Notificar eliminaciones críticas
                        if (operation === 'delete' && 
                            ['Producto', 'Comercio', 'Usuario', 'ProductoVariante', 'VentaCabecera'].includes(model)) {
                            const { notifyAdmins } = require('./notificationService');
                            const esVariante = model === 'ProductoVariante';
                            const nombreItem = registroPrevio?.nombre || registroPrevio?.sku || 'Item';
                            notifyAdmins({
                                titulo: esVariante ? 'ALERTA: Variante Eliminada' : `ALERTA: ${model} Eliminado`,
                                mensaje: esVariante 
                                    ? `Se ha eliminado la variante "${nombreItem}". Operador ID: ${currentUserId}`
                                    : `Se ha eliminado "${nombreItem}" de tipo "${model}". Operador ID: ${currentUserId}`,
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

module.exports = { 
    auditExtension, 
    auditMiddleware, 
    setAuditUser, 
    setAuditContext,
    auditContext,
    calcularDiferencias,
    generarDescripcion
};
