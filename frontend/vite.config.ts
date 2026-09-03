import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Reuse the project's shared public assets, including /images/login.jpg.
  publicDir: '../public',
});
