const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando el sembrado de datos (Seed)...');

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

  // 4. CATEGORIAS Y MARCAS (Dummy data)
  const categorias = [
    { id_categoria: 1, nombre: 'Suplementos', descripcion: 'Productos para suplementación' },
    { id_categoria: 2, nombre: 'Indumentaria', descripcion: 'Ropa deportiva' },
    { id_categoria: 3, nombre: 'Accesorios', descripcion: 'Guantes, softs, etc' },
  ];

  for (const cat of categorias) {
    await prisma.categoria.upsert({
      where: { id_categoria: cat.id_categoria },
      update: {},
      create: cat,
    });
  }

  const marcas = [
    { id_marca: 1, nombre_marca: 'Star nutrition' },
    { id_marca: 2, nombre_marca: 'Protein' },
    { id_marca: 3, nombre_marca: 'Nutrium' },
  ];

  for (const marca of marcas) {
    await prisma.marca.upsert({
      where: { id_marca: marca.id_marca },
      update: {},
      create: marca,
    });
  }
  console.log('Categorías y marcas creadas.');
 
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
      id_rol: 1, // SUPER_ADMIN
      activo: true
    }
  });
  console.log('Usuario Admin creado (user: admin, pass: admin123).');

  // 6. COMERCIO Y SUPERVISOR DE PRUEBA
  const comercioTest = await prisma.comercio.upsert({
    where: { id_comercio: '00000000-0000-0000-0000-000000000001' }, // ID fijo para pruebas
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
      id_rol: 2, // SUPERVISOR
      id_comercio_asignado: comercioTest.id_comercio,
      activo: true
    }
  });
  console.log('Comercio y Supervisor de prueba creados (user: supervisor, pass: supervisor123).');

  console.log('Seed finalizado con éxito.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
