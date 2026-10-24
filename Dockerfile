FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY . .
WORKDIR /app/backend
RUN npm install
EXPOSE 5000
CMD ["node", "server.js"]