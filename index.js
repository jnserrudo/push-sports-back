console.log('🔵 Iniciando servidor...');
const express = require('express');
console.log('✅ Express cargado');
const cors = require('cors');
console.log('✅ CORS cargado');
const morgan = require('morgan');
console.log('✅ Morgan cargado');
require('dotenv').config();
console.log('✅ Dotenv configurado');

const app = express();
console.log('✅ App Express creada');

// Middlewares básicos
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Logging middleware GLOBAL - movido al principio
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// Basic health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API running' });
});

// Ruta raíz para evitar 404 y verificar operatividad
app.get('/', (req, res) => {
    res.status(200).json({ 
        status: 'online', 
        message: 'Push Sport API - Gateway Operativo',
        timestamp: new Date().toISOString()
    });
});

// Importar Prisma ya extendido con auditoría
const prisma = require('./src/config/prisma');
const { auditMiddleware } = require('./src/services/auditService');

// Middleware de auditoría - captura el usuario después de la autenticación
// Las rutas individuales ya tienen authMiddleware, así que solo agregamos auditMiddleware
// que se ejecutará después y capturará req.user
app.use('/api', auditMiddleware);

// Routes
const salesRoutes = require('./src/routes/salesRoutes');
const liquidationRoutes = require('./src/routes/liquidationRoutes');
const bulkUpdateSimple = require('./src/routes/bulkUpdateSimple');
const productRoutes = require('./src/routes/productRoutes');
const userRoutes = require('./src/routes/userRoutes');
const commerceRoutes = require('./src/routes/commerceRoutes');
const providerRoutes = require('./src/routes/providerRoutes');
const catalogRoutes = require('./src/routes/catalogRoutes');
const inventoryRoutes = require('./src/routes/inventoryRoutes');
const notificationRoutes = require('./src/routes/notificationRoutes');
const historyRoutes = require('./src/routes/historyRoutes');
const auditRoutes = require('./src/routes/auditRoutes');
const authRoutes = require('./src/routes/authRoutes');
console.log('✅ authRoutes cargado');
const discountRoutes = require('./src/routes/discountRoutes');
const offerRoutes = require('./src/routes/offerRoutes');
const comboRoutes = require('./src/routes/comboRoutes');
const returnsRoutes = require('./src/routes/returnsRoutes');
const tipoComercioRoutes = require('./src/routes/tipoComercioRoutes');
const productVariantRoutes = require('./src/routes/productVariantRoutes');
const dashboardRoutes = require('./src/routes/dashboardRoutes');
const reportRoutes = require('./src/routes/reportRoutes');
const eventRoutes = require('./src/routes/eventRoutes');
const publicRoutes = require('./src/routes/publicRoutes');
const rectificationRoutes = require('./src/routes/rectificationRoutes');
const consultaRoutes = require('./src/routes/consultaRoutes');

// Rutas Públicas (B2C) — SIN autenticación JWT
app.use('/api/public', publicRoutes);

// Auth Routes - Cargamos esto en /api/auth para coincidir con el frontend
app.use('/api/auth', authRoutes);

app.use('/api/ventas', salesRoutes);
app.use('/api/liquidaciones', liquidationRoutes);

// Ruta simple de bulk-update - DEBE IR ANTES
app.use('/api', bulkUpdateSimple);


app.use('/api/productos', productRoutes);
app.use('/api/usuarios', userRoutes);
app.use('/api/comercios', commerceRoutes);
app.use('/api/proveedores', providerRoutes);
app.use('/api/catalogos', catalogRoutes);
app.use('/api/inventarios', inventoryRoutes);
app.use('/api/notificaciones', notificationRoutes);
app.use('/api/movimientos', historyRoutes);
app.use('/api/auditoria', auditRoutes);
app.use('/api/descuentos', discountRoutes);
app.use('/api/ofertas', offerRoutes);
app.use('/api/combos', comboRoutes);
app.use('/api/devoluciones', returnsRoutes);
app.use('/api/tipos-comercio', tipoComercioRoutes);
app.use('/api/variantes', productVariantRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/reportes', reportRoutes);
app.use('/api/eventos', eventRoutes);
app.use('/api/rectificaciones', rectificationRoutes);
app.use('/api/consultas', consultaRoutes);

// Configuración de Swagger
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const swaggerFile = './swagger-output.json';

if (fs.existsSync(swaggerFile)) {
    const swaggerDocument = require(swaggerFile);
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, { explorer: true }));
    console.log('Swagger UI inicializado en /api-docs');
} else {
    console.warn('¡Atención!: Archivo swagger-output.json no encontrado. Ejecuta "npm run swagger" para autogenerarlo.');
}

// Start Server
console.log('🔵 Iniciando servidor HTTP...');
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
    console.log(`✅ Server listening on port ${PORT}`);
    console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    console.log(`📚 API Docs: http://localhost:${PORT}/api-docs`);
    console.log('🟢 Servidor completamente iniciado y listo para recibir peticiones');
});

// Forzar que el servidor se mantenga activo
server.on('close', () => {
    console.log('⚠️ Server closed event');
});

// Detectar cierre del servidor
process.on('exit', (code) => {
    console.log(`⚠️ Process exit event with code: ${code}`);
});

process.on('SIGTERM', () => {
    console.log('⚠️ SIGTERM signal received');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('⚠️ SIGINT signal received');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Evitar salida inesperada
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    server.close(() => {
        process.exit(1);
    });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;
