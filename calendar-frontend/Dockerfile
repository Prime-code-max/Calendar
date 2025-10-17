# --- build stage ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# CRA: переменные окружения на этапе сборки можно передать через --build-arg при необходимости
RUN npm run build

# --- runtime stage ---
FROM nginx:1.27-alpine
# конфиг nginx с проксированием /api -> FastAPI
COPY nginx.conf /etc/nginx/conf.d/default.conf
# статические файлы фронта
COPY --from=build /app/build /usr/share/nginx/html
# healthcheck (необязательно)
HEALTHCHECK CMD wget -qO- http://localhost/ || exit 1
