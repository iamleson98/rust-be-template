import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
    input: 'http://localhost:8080/api-docs/openapi.json', // sign up at app.heyapi.dev
    output: 'src/lib/api',
    plugins: [
        // ...other plugins
        '@tanstack/react-query',
    ],
});