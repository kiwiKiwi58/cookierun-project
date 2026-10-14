import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// GitHub Pages 프로젝트 사이트(https://<user>.github.io/cookierun-project/)에 맞춰 base 경로 설정
export default defineConfig({
  base: '/cookierun-project/',
  plugins: [react()],
})
