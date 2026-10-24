FROM mcr.microsoft.com/playwright:v1.64.1-jammy
WORKDIR /app
COPY . .
WORKDIR /app/backend
RUN npm install
EXPOSE 5000
CMD ["node", "server.js"]