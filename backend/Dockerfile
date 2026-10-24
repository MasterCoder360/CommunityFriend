FROM mcr.microsoft.com/playwright:v1.44.0-jammy
WORKDIR /app
COPY backend/package*.json ./
RUN npm install
COPY . .
EXPOSE 5000
CMD ["npm", "start"]