# Blog Creator

Aplicación local para editar posts de varias webs con SEO predefinido y revisión antes de guardar.

## Arranque

```bash
npm start
```

Abre `http://127.0.0.1:4545`.

No se publica en Internet ni necesita base de datos. Lee y guarda los posts directamente en el proyecto local configurado. Antes de cada guardado crea una copia en `data/backups/`.

## Samuel Coach de Alemán

La primera web ya está configurada en `config/sites.json`. El panel detecta automáticamente:

- posts canónicos indexables;
- aliases, duplicados y páginas `noindex`;
- título SEO, descripción, canonical y contenido del artículo;
- imágenes y enlaces internos.

El guardado queda bloqueado si el post canónico tiene un error técnico importante: falta de H1, canonical incorrecta, `noindex`, meta vacía o imágenes sin `alt`.

## Añadir otra web

Duplica una entrada de `config/sites.json`:

```json
{
  "id": "otra-web",
  "name": "Otra web",
  "root": "/ruta/absoluta/al/proyecto",
  "baseUrl": "https://www.ejemplo.com",
  "postsDirectory": "blog",
  "imageDirectory": "assets/img/blog",
  "siteAuditCommand": "npm run audit:seo",
  "templatePost": "slug-de-post-modelo",
  "aliases": {
    "url-antigua": "url-canonica"
  }
}
```

La siguiente capa prevista es un adaptador por tipo de web para crear posts nuevos con la plantilla visual de cada proyecto, además de una revisión editorial con IA opcional. La edición y revisión SEO técnica no dependen de servicios externos.
