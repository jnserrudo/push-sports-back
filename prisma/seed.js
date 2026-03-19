const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando el sembrado de datos (Seed)...');

  // --- LIMPIEZA INICIAL ---
  console.log('Limpiando base de datos para reinicio de catálogo...');
  // Primero borramos tablas con claves foráneas que apuntan a Producto
  await prisma.inventarioComercio.deleteMany({});
  await prisma.movimientoStock.deleteMany({});
  await prisma.ventaDetalle.deleteMany({});
  await prisma.devolucion.deleteMany({});
  // Luego borramos el catálogo principal
  await prisma.producto.deleteMany({});
  await prisma.marca.deleteMany({});
  await prisma.categoria.deleteMany({});
  console.log('Limpieza completada.');

  // 1. ROLES
  const roles = [
    { id_rol: 1, nombre_rol: 'SUPER_ADMIN', descripcion: 'Administrador central con acceso total' },
    { id_rol: 2, nombre_rol: 'SUPERVISOR', descripcion: 'Gerente de sucursal con acceso a dashboard e inventario' },
    { id_rol: 3, nombre_rol: 'VENDEDOR', descripcion: 'Vendedor con acceso a POS e inventario de su sucursal' },
    { id_rol: 4, nombre_rol: 'USUARIO', descripcion: 'Usuario registrado con acceso básico' },
  ];

  for (const rol of roles) {
    await prisma.rol.upsert({
      where: { id_rol: rol.id_rol },
      update: {},
      create: rol,
    });
  }
  console.log('Roles creados.');

  // 2. TIPOS DE MOVIMIENTO
  const tiposMov = [
    { id_tipo_movimiento: 1, nombre_movimiento: 'Ingreso Inicial', factor_multiplicador: 1 },
    { id_tipo_movimiento: 2, nombre_movimiento: 'Venta', factor_multiplicador: -1 },
    { id_tipo_movimiento: 3, nombre_movimiento: 'Ajuste Stock (Positivo)', factor_multiplicador: 1 },
    { id_tipo_movimiento: 4, nombre_movimiento: 'Ajuste Stock (Negativo)', factor_multiplicador: -1 },
    { id_tipo_movimiento: 5, nombre_movimiento: 'Devolución Cliente (Ingreso)', factor_multiplicador: 1 },
    { id_tipo_movimiento: 6, nombre_movimiento: 'Devolución Proveedor (Egreso)', factor_multiplicador: -1 },
    { id_tipo_movimiento: 7, nombre_movimiento: 'Donación (Egreso)', factor_multiplicador: -1 },
    { id_tipo_movimiento: 8, nombre_movimiento: 'Rotura/Merma (Egreso)', factor_multiplicador: -1 },
  ];

  for (const tm of tiposMov) {
    await prisma.tipoMovimiento.upsert({
      where: { id_tipo_movimiento: tm.id_tipo_movimiento },
      update: {},
      create: tm,
    });
  }
  console.log('Tipos de movimiento creados.');

  // 3. TIPOS DE COMERCIO
  const tiposComercio = [
    { id_tipo_comercio: 1, nombre: 'Tienda Deportiva', descripcion: 'Venta de artículos deportivos generales' },
    { id_tipo_comercio: 2, nombre: 'Zapatillería', descripcion: 'Especializada en calzado' },
    { id_tipo_comercio: 3, nombre: 'Outlet', descripcion: 'Productos con descuento de temporadas pasadas' },
  ];

  for (const tc of tiposComercio) {
    await prisma.tipoComercio.upsert({
      where: { id_tipo_comercio: tc.id_tipo_comercio },
      update: {},
      create: tc,
    });
  }
  console.log('Tipos de comercio creados.');

  // 4. CATEGORIAS Y MARCAS (RE-CREADOS LIMPIOS)
  const categorias = [
    { id_categoria: 1, nombre: 'Suplementos', descripcion: 'Productos para suplementación' },
    { id_categoria: 2, nombre: 'Indumentaria', descripcion: 'Ropa deportiva' },
    { id_categoria: 3, nombre: 'Accesorios', descripcion: 'Guantes, shakers, etc' },
    { id_categoria: 4, nombre: 'Alimentos', descripcion: 'Comidas y snacks proteicos' },
  ];

  for (const cat of categorias) {
    await prisma.categoria.create({ data: cat });
  }

  const marcas = [
    { id_marca: 1, nombre_marca: 'STAR NUTRITION' },
    { id_marca: 2, nombre_marca: 'ONE FIT' },
    { id_marca: 3, nombre_marca: 'GRANGER FOODS' },
    { id_marca: 4, nombre_marca: 'INTEGRA' },
    { id_marca: 5, nombre_marca: 'GENERAL' },
  ];

  for (const marca of marcas) {
    await prisma.marca.create({ data: marca });
  }
  console.log('Categorías y marcas creadas.');

  // 7. PRODUCTOS INICIALES (ESTRICTAMENTE LOS 40 DEL PROYECTO REPORTE)
  let supabaseMap = {};
  const mapPath = require('path').join(__dirname, 'supabase_image_map.json');
  if (require('fs').existsSync(mapPath)) {
    supabaseMap = JSON.parse(require('fs').readFileSync(mapPath, 'utf8'));
  }

  const staticProducts = [
    { marca: 'STAR NUTRITION', nombre: 'Creatina 300 Grs Star', sabores: ['Frutos Rojos','Neutro'], precioPush: 25000, precioPublico: 30000, imagen: 'v1/Creatina_star_sobre.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Creatina 200 Grs One Fit', sabores: [], precioPush: 28000, precioPublico: 33000, imagen: 'v1/Creatina_One_Fit_200g.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Creatina 500 Grs One Fit Pote', sabores: [], precioPush: 28000, precioPublico: 33000, imagen: 'img_one_fit_creatina_500g.jpeg', catId: 1 }, 
    { marca: 'STAR NUTRITION', nombre: 'L-Carnitina Star Nutrition', sabores: [], precioPush: 8000, precioPublico: 12000, imagen: 'v1/L-Carnitina_Star_Nutrition.jpeg', catId: 1 }, 
    { marca: 'STAR NUTRITION', nombre: 'Proteina Star 1 Kg', sabores: ['Frutilla', 'Chocolate', 'Banana', 'Cookie', 'Vainilla'], precioPush: 42000, precioPublico: 47000, imagen: 'v1/Proteina_Star_1kg.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Proteina Star 1 Kg (Con Colageno)', sabores: ['Vainilla', 'Chocolate'], precioPush: 42000, precioPublico: 47000, imagen: 'v1/Proteina_Star_1kg_colageno.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Proteina Star Organica', sabores: [], precioPush: 42000, precioPublico: 47000, imagen: 'v1/Proteina-Star-Organica.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Proteina One Fit', sabores: ['Vainilla', 'Frutilla', 'Chocolate'], precioPush: 28000, precioPublico: 33000, imagen: 'v1/Proteina_Onefit.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Fat Distroyer 2.0 One Fit (90 Caps)', sabores: [], precioPush: 14000, precioPublico: 19000, imagen: 'img_quemador_fat_destroyer_one_fit.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Bcca Star 270grs (en Polvo)', sabores: ['Limon','Frutos Rojos'], precioPush: 8000, precioPublico: 12000, imagen: 'v1/Bcca_star_270.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Bcca Star En Capsulas', sabores: [], precioPush: 8000, precioPublico: 12000, imagen: 'img_bcaa_star_2000.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Bcca One Fit 300grs', sabores: [], precioPush: 28000, precioPublico: 33000, imagen: 'v1/Bcca_One_Fit_300g.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Eaa´s Essential Aminos (360 Gr) Star', sabores: [], precioPush: 30000, precioPublico: 35000, imagen: 'img_eaas_essential_aminos_star.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Omega 3 Star (60 Comp)', sabores: [], precioPush: 30000, precioPublico: 35000, imagen: 'img_omega_3_star.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Omega 3 One Fit (30 Comp)', sabores: [], precioPush: 28000, precioPublico: 33000, imagen: 'v1/Omega3_Onefit_30comp.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Pre Entreno Star V8', sabores: ['Sandia', 'Acai'], precioPush: 34000, precioPublico: 40000, imagen: 'img_pre_entreno_pump_v8.jpeg', catId: 1 },
    { marca: '-', nombre: 'Pre Entreno 3d Limon', sabores: ['Limon'], precioPush: 17000, precioPublico: 20000, imagen: 'img_pre_entreno_3d_ripped.jpeg', catId: 1 },
    { marca: '-', nombre: 'Pre Entreno Tnt', sabores: ['Acai', 'Blue Razz'], precioPush: 23000, precioPublico: 28000, imagen: 'img_pre_entreno_tnt.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Pre Entreno One Fit', sabores: ['Limon', 'Uva'], precioPush: 17000, precioPublico: 20000, imagen: 'v1/Preentreno_OneFit.jpeg', catId: 1 },
    { marca: '-', nombre: 'Shaker Gris', sabores: [], precioPush: 12000, precioPublico: 17000, imagen: 'img_shaker_gris.jpeg', catId: 3 },
    { marca: '-', nombre: 'Shaker Rosa', sabores: [], precioPush: 12000, precioPublico: 17000, imagen: 'v1/Shaker_rosa.jpeg', catId: 3 },
    { marca: 'GRANGER FOODS', nombre: 'Panqueques Granger', sabores: ['Chocolate', 'Vainilla'], precioPush: 10000, precioPublico: 15000, imagen: 'v1/Panqueques_Granger.jpeg', catId: 4 },
    { marca: 'GRANGER FOODS', nombre: 'Galleta Granger', sabores: [], precioPush: 9000, precioPublico: 12000, imagen: 'img_cookies_granger.jpeg', catId: 4 },
    { marca: '-', nombre: 'Panqueques Queso', sabores: ['Queso'], precioPush: 12000, precioPublico: 14000, imagen: 'img_pancake_salado_queso.jpeg', catId: 4 },
    { marca: '-', nombre: 'Panqueques Mole Vainilla', sabores: ['Vainilla'], precioPush: 12000, precioPublico: 14000, imagen: 'img_pancake_vainilla.jpeg', catId: 4 },
    { marca: '-', nombre: 'Panqueque Keto', sabores: [], precioPush: 0, precioPublico: 0, imagen: 'v1/Panqueques_Keto.jpeg', catId: 4 },
    { marca: '-', nombre: 'Cupcke Microondas', sabores: [], precioPush: 0, precioPublico: 0, imagen: 'v1/Cupcakes_Proteicos.jpeg', catId: 4 },
    { marca: 'STAR NUTRITION', nombre: 'Colageno Star', sabores: ['Limon', 'Frutos Rojos'], precioPush: 21000, precioPublico: 26000, imagen: 'v1/Colageno_Limon.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Colageno One Fit 240 Gr', sabores: ['Naranja', 'Frutilla'], precioPush: 14000, precioPublico: 18000, imagen: 'v1/Colageno_Onefit_240gr.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Citrato De Magnesio Star', sabores: ['Neutro', 'Frutos Rojos'], precioPush: 27000, precioPublico: 32000, imagen: 'img_citrato_magnesio_star.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Citrato De Magnesio Star Comp 60u', sabores: [], precioPush: 27000, precioPublico: 32000, imagen: 'v1/Citrato_Magnesio_Star_Com_60u.jpeg', catId: 1 },
    { marca: 'ONE FIT', nombre: 'Citrato De Magnesio One Fit Sin Sabor', sabores: [], precioPush: 12000, precioPublico: 17000, imagen: 'img_citrato_magnesio_onefit.jpeg', catId: 1 },
    { marca: '-', nombre: 'Hydro Max', sabores: ['Naranja', 'Pomelo'], precioPush: 14000, precioPublico: 18000, imagen: 'v1/Hydro_Max.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Vitamina C Star', sabores: [], precioPush: 8000, precioPublico: 12000, imagen: 'img_vitamina_c_star_nutrition.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Multivitaminico Star', sabores: [], precioPush: 8000, precioPublico: 12000, imagen: 'v1/Multivitaminico_Star.jpeg', catId: 1 },
    { marca: 'STAR NUTRITION', nombre: 'Colageno hidrolizado con Resveratrol Star - 20 servicios', sabores: ['Limon', 'Frutos Rojos'], precioPush: 19000, precioPublico: 24000, imagen: 'collageno_hidrolizado_star_210g.jpeg', catId: 1 },
    { marca: '-', nombre: 'Reverastrol', sabores: [], precioPush: 0, precioPublico: 0, imagen: 'v1/Reverastrol.jpeg', catId: 1 },
    { marca: '-', nombre: 'Barras Cereales', sabores: [], precioPush: 0, precioPublico: 0, imagen: 'v1/Barra_chocolate.jpeg', catId: 4 },
    { marca: 'INTEGRA', nombre: 'Caja Integra', sabores: ['Mani Y Chocolate', 'Arandanos', 'Chocolate Y Mani', 'Girasol Y Arandanos'], precioPush: 20000, precioPublico: 0, imagen: 'img_integra_barritas_caja.jpeg', catId: 4 },
  ];

  for (const p of staticProducts) {
    const brandName = p.marca === '-' ? 'GENERAL' : p.marca.toUpperCase();
    const brand = marcas.find(m => m.nombre_marca === brandName) || marcas[4];
    const finalImageUrl = supabaseMap[p.imagen] || p.imagen;

    console.log(`Creando: ${p.nombre}`);
    await prisma.producto.create({
        data: {
            nombre: p.nombre,
            descripcion: p.sabores.length > 0 ? `Sabores: ${p.sabores.join(', ')}` : '',
            id_categoria: p.catId,
            id_marca: brand.id_marca,
            precio_pushsport: p.precioPush,
            precio_venta_sugerido: p.precioPublico,
            costo_compra: p.precioPush > 0 ? p.precioPush * 0.8 : 0,
            imagen_url: finalImageUrl,
            stock_minimo: 5,
            atributos: { sabores: p.sabores, origen: 'Curación Final' },
            activo: true
        }
    });
  }

  console.log('Productos sincronizados.');

  // 5. USUARIO INICIAL (ADMIN)
  const salt = await require('bcryptjs').genSalt(10);
  const password_hash = await require('bcryptjs').hash('admin123', salt);

  await prisma.usuario.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      nombre: 'Admin',
      apellido: 'Principal',
      username: 'admin',
      email: 'admin@pushsports.com',
      password_hash: password_hash,
      id_rol: 1,
      activo: true
    }
  });

  // 6. COMERCIO Y SUPERVISOR DE PRUEBA
  const comercioTest = await prisma.comercio.upsert({
    where: { id_comercio: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id_comercio: '00000000-0000-0000-0000-000000000001',
      nombre: 'Sucursal Centro (Test)',
      id_tipo_comercio: 1,
      direccion: 'Av. Siempre Viva 123',
      activo: true
    }
  });

  const passSupervisor = await require('bcryptjs').hash('supervisor123', salt);
  await prisma.usuario.upsert({
    where: { username: 'supervisor' },
    update: {},
    create: {
      nombre: 'Supervisor',
      apellido: 'De Prueba',
      username: 'supervisor',
      email: 'supervisor@test.com',
      password_hash: passSupervisor,
      id_rol: 2,
      id_comercio_asignado: comercioTest.id_comercio,
      activo: true
    }
  });

  console.log('Seed finalizado con éxito.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
