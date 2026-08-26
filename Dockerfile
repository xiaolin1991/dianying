# 晓林影视 XIAOLIN-TV — 自托管镜像(VPS / Docker / 群晖等)
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8788 DATA_DIR=/data

# 无任何 npm 依赖, 直接拷贝运行所需文件
COPY _worker.js ./
COPY server ./server
COPY public ./public

VOLUME ["/data"]
EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8788/api/health || exit 1

CMD ["node", "server/node-server.mjs"]
