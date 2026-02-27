const swaggerAutogen = require('swagger-autogen')({ openapi: '3.0.0' });

const doc = {
  info: {
    title: 'Push Sports API',
    description: 'Documentación Oficial del Backend de Push Sports. ERD v2 y RBAC implementado.',
    version: '2.0.0'
  },
  servers: [
    {
      url: 'http://localhost:3000/api',
      description: 'Servidor Local'
    }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT'
      }
    }
  },
  security: [{ bearerAuth: [] }]
};

const outputFile = './swagger-output.json';
const outputYamlFile = './swagger-output.yaml';
const routes = ['./index.js'];

// Generar el archivo JSON y luego convertirlo a YAML
swaggerAutogen(outputFile, routes, doc).then(() => {
    console.log('Swagger JSON autogenerado exitosamente en swagger-output.json');
    
    // Convertir de JSON a YAML
    const fs = require('fs');
    const yaml = require('js-yaml');
    try {
        const fileContents = fs.readFileSync(outputFile, 'utf8');
        const data = JSON.parse(fileContents);
        const yamlStr = yaml.dump(data);
        fs.writeFileSync(outputYamlFile, yamlStr, 'utf8');
        console.log('Swagger YAML (OpenAPI 3.0) generado exitosamente en swagger-output.yaml');
    } catch (e) {
        console.error('Error al convertir JSON a YAML:', e);
    }
});
