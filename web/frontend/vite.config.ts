import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 产物直接输出到 Spring Boot 静态目录（打包进 jar），部署方式不变。
// 开发模式：npm run dev → 5173 端口，/api 与 /ws 代理到本地 8080。
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: '../src/main/resources/static',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:8080', changeOrigin: true },
      '/ws': { target: 'http://localhost:8080', ws: true }
    }
  }
})
