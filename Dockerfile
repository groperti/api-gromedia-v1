FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++ ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE 4881
CMD ["node", "dist/main"]
