const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
require('dotenv').config();

const app = express();

// Middlewares básicos
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Basic health check
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', message: 'API running' });
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

// Rutas Públicas (B2C) — SIN autenticación JWT
app.use('/api/public', publicRoutes);

// Auth Routes - Cargamos esto ANTES para que /api/login etc funcionen correctamente
app.use('/api', authRoutes);

app.use('/api/ventas', salesRoutes);
app.use('/api/liquidaciones', liquidationRoutes);
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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});

module.exports = app;
