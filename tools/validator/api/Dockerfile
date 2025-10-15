FROM alpine:3.18

RUN apk add --no-cache nodejs npm libxml2-utils
WORKDIR /app
COPY server.js /app/server.js
COPY package.json /app/package.json
RUN npm install express body-parser

EXPOSE 3001
CMD ["node", "server.js"]
