FROM node:24-alpine

WORKDIR /app

COPY package.json server.mjs export-leads.mjs ./

RUN mkdir -p /data && chown -R node:node /app /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    LEADS_DB_PATH=/data/leads.db

USER node

VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
