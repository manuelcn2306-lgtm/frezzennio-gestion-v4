FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN node init-db.js
EXPOSE 3000
CMD CMD ["sh","-c","node init-db.js && node server.js"]
