const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando script de migración para CodigoProducto...');

  // 1. Crear el código por defecto "-"
  const defaultCodigo = await prisma.codigoProducto.upsert({
    where: { codigo: '-' },
    update: {},
    create: {
      codigo: '-',
      descripcion: 'Sin código asignado'
    }
  });

  console.log('Código por defecto creado:', defaultCodigo.codigo);

  // 2. Asignar este código a todos los productos que no tengan uno
  const result = await prisma.producto.updateMany({
    where: {
      id_codigo_producto: null
    },
    data: {
      id_codigo_producto: defaultCodigo.id_codigo
    }
  });

  console.log(`Se actualizaron ${result.count} productos con el código por defecto.`);
  console.log('Migración completada exitosamente.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
