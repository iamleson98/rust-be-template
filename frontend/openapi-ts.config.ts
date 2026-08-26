import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
    input: 'http://127.0.0.1:8080/api-docs/openapi.json', // sign up at app.heyapi.dev
    output: 'src/lib/api',
    plugins: [
        '@hey-api/client-fetch',
        '@tanstack/react-query',
    ],
});