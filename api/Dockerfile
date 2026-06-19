FROM node:20-alpine

# better-sqlite3 needs native build tools
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

EXPOSE 3000

CMD ["sh", "-c", "node dist/seeds/users.js && node dist/index.js"]
